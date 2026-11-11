import { SvelteMap } from 'svelte/reactivity';
import {
	Clock,
	KINDS,
	isKind,
	join,
	merge,
	newReplicaId,
	stamp,
	type Change,
	type Hlc,
	type Kind,
	type Op,
	type Rec
} from './op';
import { INDEXES, Store, type Invalidate, type Meta, type Touched } from './store';

type Range = { readonly lo: IDBValidKey; readonly hi: IDBValidKey };

/** What another tab of this device tells the others after it writes. */
type Message = { readonly touched: readonly (readonly [Kind, string])[]; readonly outbox: boolean };

export type ReplicaOptions = {
	readonly name?: string;
	readonly factory?: IDBFactory;
	readonly now?: () => number;
	/** dayAgg keys a change makes stale. The domain owns this rule, not the replica. */
	readonly invalidate?: Invalidate;
	/** Other tabs of this device, or null to run alone. */
	readonly channel?: BroadcastChannel | null;
};

/** Ranges hold ids (strings) or indexed `at` values (numbers), never a mix. */
function inRange(v: unknown, r: Range): boolean {
	return (
		typeof v === typeof r.lo &&
		(v as string) >= (r.lo as string) &&
		(v as string) < (r.hi as string)
	);
}

/**
 * The device's copy of the data, and its only writer. IndexedDB holds everything this
 * device has seen; the mirror is the reactive subset that views read: whole kinds, key
 * ranges, or index ranges, as loaded. Both change only through merge, so they cannot
 * disagree for long, and the mirror joins rather than overwrites when IndexedDB catches up.
 */
export class Replica {
	readonly mirror: { readonly [K in Kind]: SvelteMap<string, Rec> };
	readonly #store: Store;
	readonly #clock: Clock;
	readonly #now: () => number;
	readonly #invalidate: Invalidate | undefined;
	readonly #channel: BroadcastChannel | null;
	readonly #whole = new Set<Kind>();
	readonly #keyRanges = new Map<Kind, Range[]>();
	readonly #indexRanges = new Map<Kind, Range[]>();
	readonly #listeners = new Set<() => void>();
	#meta: Meta;
	#writes: Promise<unknown> = Promise.resolve();

	private constructor(store: Store, meta: Meta, options: ReplicaOptions) {
		this.#store = store;
		this.#meta = meta;
		this.#clock = new Clock(newReplicaId(), meta.maxHlc);
		this.#now = options.now ?? Date.now;
		this.#invalidate = options.invalidate;
		this.#channel = options.channel ?? null;
		this.mirror = Object.fromEntries(KINDS.map((k) => [k, new SvelteMap<string, Rec>()])) as {
			[K in Kind]: SvelteMap<string, Rec>;
		};
		this.#channel?.addEventListener('message', (e: MessageEvent<Message>) => {
			void this.#heard(e.data);
		});
	}

	static async open(options: ReplicaOptions = {}): Promise<Replica> {
		const store = await Store.open(options.name, options.factory);
		const replica = new Replica(store, await store.meta(), options);
		const known = (await store.orphans()).filter((op) => isKind(op.kind));
		if (known.length) {
			await store.apply({
				ops: known,
				dropOrphans: known.map((op) => op.hlc),
				invalidate: options.invalidate
			});
		}
		return replica;
	}

	close(): void {
		this.#channel?.close();
		this.#store.close();
	}

	get cursor(): { readonly epoch: string | null; readonly seq: number } {
		return { epoch: this.#meta.epoch, seq: this.#meta.cursor };
	}

	/** The store, for reads that bypass the mirror (the aggregate cache). */
	get store(): Store {
		return this.#store;
	}

	#inScope(kind: Kind, rec: Rec): boolean {
		if (this.#whole.has(kind)) return true;
		if (this.#keyRanges.get(kind)?.some((r) => inRange(rec.id, r))) return true;
		const index = INDEXES[kind];
		if (!index) return false;
		const v = rec.regs[index.field]?.v;
		return v !== undefined && (this.#indexRanges.get(kind)?.some((r) => inRange(v, r)) ?? false);
	}

	#show(kind: Kind, recs: readonly Rec[]): void {
		const m = this.mirror[kind];
		for (const rec of recs) {
			const cur = m.get(rec.id);
			const next = join(cur, rec);
			if (!this.#inScope(kind, next)) {
				if (cur) m.delete(rec.id);
			} else if (next !== cur) m.set(rec.id, next);
		}
	}

	/** Load a whole kind into the mirror, and keep it loaded. */
	async loadAll(kind: Kind): Promise<void> {
		this.#whole.add(kind);
		this.#show(kind, await this.#store.read(kind));
	}

	/** Load the records whose id is in [lo, hi), and keep that range loaded. */
	async loadKeys(kind: Kind, lo: string, hi: string): Promise<void> {
		this.#keyRanges.set(kind, [...(this.#keyRanges.get(kind) ?? []), { lo, hi }]);
		this.#show(kind, await this.#store.read(kind, { lo, hi }));
	}

	/** Load the records whose indexed value is in [lo, hi), and keep that range loaded. */
	async loadIndex(kind: Kind, lo: number, hi: number): Promise<void> {
		this.#indexRanges.set(kind, [...(this.#indexRanges.get(kind) ?? []), { lo, hi }]);
		this.#show(kind, await this.#store.read(kind, { lo, hi, index: true }));
	}

	/**
	 * Called after this device's outbox gains ops, from this tab or another. Ops pulled from
	 * the server do not call it: they leave nothing to push. Returns an unsubscribe.
	 */
	onChange(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#notify(): void {
		for (const l of this.#listeners) l();
	}

	/**
	 * The tap path. Stamps and merges into the mirror synchronously, so views derived from
	 * it update before the next paint; the IndexedDB transaction follows without being
	 * awaited. IndexedDB runs readwrite transactions in the order they were created.
	 */
	commit(changes: readonly Change[]): readonly Op[] {
		const ops = changes.map((c) => stamp(c, this.#clock.tick(this.#now())));
		for (const op of ops) {
			const kind = op.kind as Kind;
			const m = this.mirror[kind];
			const cur = m.get(op.id);
			const next = merge(cur, op);
			if (next === cur) continue;
			if (this.#inScope(kind, next)) m.set(op.id, next);
			else if (cur) m.delete(op.id);
		}
		this.#write(
			this.#store.apply({ ops, enqueue: true, invalidate: this.#invalidate }).then((touched) => {
				this.#after(touched, true);
			})
		);
		return ops;
	}

	#write(p: Promise<void>): void {
		const settled = p.catch((e: unknown) => console.error('heimdall: write failed', e));
		this.#writes = Promise.all([this.#writes, settled]);
	}

	/** Resolves once every commit so far is durable. */
	flushed(): Promise<void> {
		return this.#writes.then(() => undefined);
	}

	#after(touched: readonly Touched[], outbox: boolean): void {
		for (const t of touched) this.#show(t.kind, [t.next]);
		this.#channel?.postMessage({
			touched: touched.map((t) => [t.kind, t.next.id] as const),
			outbox
		} satisfies Message);
		if (outbox) this.#notify();
	}

	async #heard(msg: Message): Promise<void> {
		const byKind = new Map<Kind, string[]>();
		for (const [kind, id] of msg.touched) byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
		for (const [kind, ids] of byKind) {
			const recs = await this.#store.get(kind, ids);
			this.#show(
				kind,
				recs.filter((r) => r !== undefined)
			);
		}
		this.#meta = await this.#store.meta();
		if (msg.outbox) this.#notify();
	}

	/** Ops waiting for the server, oldest first. */
	pending(max: number): Promise<Op[]> {
		return this.#store.outbox(max);
	}

	/** How many ops wait for the server, counting every commit made so far. */
	async waiting(): Promise<number> {
		await this.#writes;
		return this.#store.waiting();
	}

	/** Drop ops from the outbox without sending them; the records keep their values. */
	async forget(hlcs: readonly Hlc[]): Promise<void> {
		await this.#store.apply({ ops: [], acked: hlcs });
	}

	/** Apply a pull response in one transaction, then reflect it in the mirror. */
	async absorb(batch: {
		readonly ops: readonly Op[];
		readonly acked: readonly Hlc[];
		readonly cursor: number;
		readonly epoch: string;
	}): Promise<void> {
		await this.#writes;
		const touched = await this.#store.apply({
			ops: batch.ops,
			acked: batch.acked,
			meta: { cursor: batch.cursor, epoch: batch.epoch },
			invalidate: this.#invalidate
		});
		this.#meta = { ...this.#meta, cursor: batch.cursor, epoch: batch.epoch };
		for (const op of batch.ops) this.#clock.observe(op.hlc);
		this.#after(touched, false);
	}

	/** The server's epoch changed: queue everything held here and pull from the start. */
	async reseed(epoch: string): Promise<void> {
		await this.#writes;
		await this.#store.reseed(epoch);
		this.#meta = { ...this.#meta, cursor: 0, epoch };
	}
}
