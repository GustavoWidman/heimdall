import { KINDS, isKind, merge, opsFromRecord, type Hlc, type Kind, type Op, type Rec } from './op';

/**
 * The device's durable copy, in IndexedDB. One store per kind, keyed by entity id, with
 * marks indexed by their `at` register. Beside them: `outbox` (ops the server has not
 * acknowledged), `orphan` (ops of kinds this build does not know), `meta` (one row), and
 * `dayAgg` (cached per-day rows, keyed by day, deleted when a write makes them stale).
 */

export type Meta = {
	/** The last server seq this device has absorbed. */
	readonly cursor: number;
	/** The server database the cursor refers to. */
	readonly epoch: string | null;
	/** The highest clock this device has seen, the floor for its next clock. */
	readonly maxHlc: Hlc | null;
	/** Bumped by every write that makes an aggregate row stale. */
	readonly aggGen: number;
};

/** A record a transaction changed, with what it was before. */
export type Touched = { readonly kind: Kind; readonly prev: Rec | undefined; readonly next: Rec };

/** Keys of `dayAgg` rows a change makes stale. */
export type Invalidate = (t: Touched) => readonly string[];

/** Indexes on stored records, as IndexedDB key paths into the registers. */
export const INDEXES: { readonly [K in Kind]?: { readonly field: string } } = {
	mark: { field: 'at' }
};

const VERSION = 1;
const META_KEY = 'meta';
const EMPTY_META: Meta = { cursor: 0, epoch: null, maxHlc: null, aggGen: 0 };
const BOOKKEEPING = ['outbox', 'orphan', 'meta', 'dayAgg'] as const;

function done<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function finished(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
	});
}

function maxOf(a: Hlc | null, b: Hlc | null): Hlc | null {
	return a === null ? b : b === null || a >= b ? a : b;
}

export class Store {
	readonly #db: IDBDatabase;

	private constructor(db: IDBDatabase) {
		this.#db = db;
	}

	static async open(name = 'heimdall', factory: IDBFactory = indexedDB): Promise<Store> {
		const req = factory.open(name, VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const kind of KINDS) {
				const store = db.createObjectStore(kind, { keyPath: 'id' });
				const index = INDEXES[kind];
				if (index) store.createIndex(index.field, `regs.${index.field}.v`);
			}
			db.createObjectStore('outbox', { keyPath: 'hlc' });
			db.createObjectStore('orphan', { keyPath: 'hlc' });
			db.createObjectStore('meta');
			db.createObjectStore('dayAgg', { keyPath: 'day' });
		};
		return new Store(await done(req));
	}

	close(): void {
		this.#db.close();
	}

	async meta(): Promise<Meta> {
		const tx = this.#db.transaction('meta', 'readonly');
		return ((await done(tx.objectStore('meta').get(META_KEY))) as Meta | undefined) ?? EMPTY_META;
	}

	/** Records of one kind; all of them, or a key range, or an index range. */
	async read(
		kind: Kind,
		range?: { readonly lo: IDBValidKey; readonly hi: IDBValidKey; readonly index?: boolean }
	): Promise<Rec[]> {
		const store = this.#db.transaction(kind, 'readonly').objectStore(kind);
		if (!range) return done(store.getAll());
		const keys = IDBKeyRange.bound(range.lo, range.hi, false, true);
		const index = INDEXES[kind];
		if (range.index && index) return done(store.index(index.field).getAll(keys));
		return done(store.getAll(keys));
	}

	async get(kind: Kind, ids: readonly string[]): Promise<(Rec | undefined)[]> {
		const store = this.#db.transaction(kind, 'readonly').objectStore(kind);
		return Promise.all(ids.map((id) => done(store.get(id) as IDBRequest<Rec | undefined>)));
	}

	/** Unacknowledged ops, oldest clock first, so the server sees each replica's ops in order. */
	async outbox(limit: number): Promise<Op[]> {
		const tx = this.#db.transaction('outbox', 'readonly');
		return done(tx.objectStore('outbox').getAll(null, limit));
	}

	async orphans(): Promise<Op[]> {
		return done(this.#db.transaction('orphan', 'readonly').objectStore('orphan').getAll());
	}

	async aggregates<T>(days: readonly string[]): Promise<(T | undefined)[]> {
		const store = this.#db.transaction('dayAgg', 'readonly').objectStore('dayAgg');
		return Promise.all(days.map((d) => done(store.get(d) as IDBRequest<T | undefined>)));
	}

	/**
	 * Store recomputed rows, unless a write made any aggregate stale since `gen` was read:
	 * the rows may predate that write, and storing them would hide it.
	 */
	async putAggregates(rows: readonly { readonly day: string }[], gen: number): Promise<boolean> {
		const tx = this.#db.transaction(['dayAgg', 'meta'], 'readwrite');
		let stored = false;
		const metaReq = tx.objectStore('meta').get(META_KEY) as IDBRequest<Meta | undefined>;
		metaReq.onsuccess = () => {
			if ((metaReq.result ?? EMPTY_META).aggGen !== gen) return;
			for (const row of rows) tx.objectStore('dayAgg').put(row);
			stored = true;
		};
		await finished(tx);
		return stored;
	}

	/**
	 * One readwrite transaction: merge ops into their records, set aside ops of unknown
	 * kinds, queue local ops in the outbox, drop acknowledged ones, delete the aggregate
	 * rows the changes make stale, and move meta. It commits whole or not at all, so after a
	 * crash the cursor has not moved and the next pull re-delivers ops that merge the same.
	 */
	async apply(batch: {
		readonly ops: readonly Op[];
		readonly enqueue?: boolean;
		readonly acked?: readonly Hlc[];
		readonly dropOrphans?: readonly Hlc[];
		readonly meta?: Partial<Pick<Meta, 'cursor' | 'epoch'>>;
		readonly invalidate?: Invalidate;
	}): Promise<Touched[]> {
		const tx = this.#db.transaction([...KINDS, ...BOOKKEEPING], 'readwrite');
		const touched: Touched[] = [];
		const agg = tx.objectStore('dayAgg');
		const groups = new Map<string, { kind: Kind; id: string; ops: Op[] }>();
		let max: Hlc | null = null;
		let stale = false;
		for (const op of batch.ops) {
			max = maxOf(max, op.hlc);
			if (!isKind(op.kind)) {
				tx.objectStore('orphan').put(op);
				continue;
			}
			const key = `${op.kind}\u0000${op.id}`;
			let g = groups.get(key);
			if (!g) groups.set(key, (g = { kind: op.kind, id: op.id, ops: [] }));
			g.ops.push(op);
		}
		for (const { kind, id, ops } of groups.values()) {
			const store = tx.objectStore(kind);
			const req = store.get(id) as IDBRequest<Rec | undefined>;
			req.onsuccess = () => {
				const prev = req.result;
				let next = prev;
				for (const op of ops) next = merge(next, op);
				if (!next || next === prev) return;
				store.put(next);
				const t = { kind, prev, next };
				touched.push(t);
				for (const day of batch.invalidate?.(t) ?? []) {
					agg.delete(day);
					stale = true;
				}
			};
		}
		if (batch.enqueue) for (const op of batch.ops) tx.objectStore('outbox').put(op);
		for (const hlc of batch.acked ?? []) tx.objectStore('outbox').delete(hlc);
		for (const hlc of batch.dropOrphans ?? []) tx.objectStore('orphan').delete(hlc);
		const metaStore = tx.objectStore('meta');
		const metaReq = metaStore.get(META_KEY) as IDBRequest<Meta | undefined>;
		metaReq.onsuccess = () => {
			const cur = metaReq.result ?? EMPTY_META;
			const aggGen = cur.aggGen + (stale ? 1 : 0);
			metaStore.put({ ...cur, ...batch.meta, maxHlc: maxOf(cur.maxHlc, max), aggGen }, META_KEY);
		};
		await finished(tx);
		return touched;
	}

	/**
	 * The server lost data (its epoch changed). Queue every register this device holds,
	 * rebuilt as ops with their original clocks, and pull again from the start. The server
	 * ignores clocks it already has, so this is safe to repeat.
	 */
	async reseed(epoch: string): Promise<void> {
		const tx = this.#db.transaction([...KINDS, ...BOOKKEEPING], 'readwrite');
		const outbox = tx.objectStore('outbox');
		for (const kind of KINDS) {
			const req = tx.objectStore(kind).getAll() as IDBRequest<Rec[]>;
			req.onsuccess = () => {
				for (const rec of req.result) for (const op of opsFromRecord(kind, rec)) outbox.put(op);
			};
		}
		const orphans = tx.objectStore('orphan').getAll() as IDBRequest<Op[]>;
		orphans.onsuccess = () => {
			for (const op of orphans.result) outbox.put(op);
		};
		const metaStore = tx.objectStore('meta');
		const metaReq = metaStore.get(META_KEY) as IDBRequest<Meta | undefined>;
		metaReq.onsuccess = () => {
			metaStore.put({ ...(metaReq.result ?? EMPTY_META), cursor: 0, epoch }, META_KEY);
		};
		await finished(tx);
	}
}
