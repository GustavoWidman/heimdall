import { parseOp, type Hlc, type Op } from './op';

/**
 * The sync loop. One request pushes the outbox and pulls everything after the cursor
 * (`POST /api/sync`, see contract/sync.json), repeated while the server says `more` or the
 * outbox still holds ops. Every step is safe to repeat: the server ignores clocks it has,
 * and merge ignores ops this device has seen, so a lost response costs only a resend.
 */

export type SyncStatus =
	| { readonly kind: 'idle'; readonly lastOk: number | null }
	| { readonly kind: 'syncing' }
	| { readonly kind: 'offline'; readonly retryAt: number }
	| { readonly kind: 'needs-login' };

/** What sync needs from the replica. */
export type SyncReplica = {
	readonly cursor: { readonly epoch: string | null; readonly seq: number };
	pending(max: number): Promise<readonly Op[]>;
	absorb(batch: {
		readonly ops: readonly Op[];
		readonly acked: readonly Hlc[];
		readonly cursor: number;
		readonly epoch: string;
	}): Promise<void>;
	reseed(epoch: string): Promise<void>;
	forget(hlcs: readonly Hlc[]): Promise<void>;
	onChange(listener: () => void): () => void;
};

type LiveSource = {
	addEventListener(type: 'head', listener: (e: MessageEvent<string>) => void): void;
	close(): void;
};

export type SyncEnv = {
	readonly fetch: typeof fetch;
	/** Prefix for API paths, '' in the app. */
	readonly base?: string;
	readonly now?: () => number;
	readonly random?: () => number;
	readonly schedule?: (run: () => void, ms: number) => () => void;
	/** Opens `GET /api/live`. Null to rely on wakes alone. */
	readonly live?: ((url: string) => LiveSource) | null;
	/** Elects one syncing tab per device. Null to sync in every context. */
	readonly locks?: LockManager | null;
	/** Where to listen for `online` and `visibilitychange`. */
	readonly events?: EventTarget | null;
	readonly isVisible?: () => boolean;
	readonly onStatus?: (status: SyncStatus) => void;
};

const PUSH_LIMIT = 500;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

type SyncResponse = {
	readonly epoch: string;
	readonly head: number;
	readonly ops: readonly { readonly seq: number; readonly op: unknown }[];
	readonly more: boolean;
};

function parseResponse(json: unknown): SyncResponse | null {
	if (typeof json !== 'object' || json === null) return null;
	const r = json as Record<string, unknown>;
	if (typeof r.epoch !== 'string' || !Number.isSafeInteger(r.head) || typeof r.more !== 'boolean') {
		return null;
	}
	if (!Array.isArray(r.ops)) return null;
	for (const e of r.ops as unknown[]) {
		if (typeof e !== 'object' || e === null || !Number.isSafeInteger((e as { seq: unknown }).seq)) {
			return null;
		}
	}
	return r as unknown as SyncResponse;
}

function defaultSchedule(run: () => void, ms: number): () => void {
	const t = setTimeout(run, ms);
	return () => clearTimeout(t);
}

export class Sync {
	readonly #replica: SyncReplica;
	readonly #env: SyncEnv;
	readonly #base: string;
	readonly #now: () => number;
	#status: SyncStatus = { kind: 'idle', lastOk: null };
	#running: Promise<void> | null = null;
	#again = false;
	#attempt = 0;
	#cancelRetry: (() => void) | null = null;
	#live: LiveSource | null = null;
	#stopped = false;
	#cleanup: (() => void)[] = [];

	constructor(replica: SyncReplica, env: SyncEnv) {
		this.#replica = replica;
		this.#env = env;
		this.#base = env.base ?? '';
		this.#now = env.now ?? Date.now;
	}

	get status(): SyncStatus {
		return this.#status;
	}

	#set(status: SyncStatus): void {
		this.#status = status;
		this.#env.onStatus?.(status);
	}

	/** Start syncing. With locks, only the tab holding the lock runs the loop. */
	start(): void {
		const lead = () => {
			if (this.#stopped) return;
			this.#cleanup.push(this.#replica.onChange(() => this.wake()));
			const events = this.#env.events;
			if (events) {
				const onOnline = () => this.wake();
				const onVisible = () => {
					if (this.#env.isVisible?.() ?? true) this.wake();
				};
				events.addEventListener('online', onOnline);
				events.addEventListener('visibilitychange', onVisible);
				this.#cleanup.push(() => {
					events.removeEventListener('online', onOnline);
					events.removeEventListener('visibilitychange', onVisible);
				});
			}
			this.wake();
		};
		const locks = this.#env.locks;
		if (!locks) return lead();
		void locks.request('heimdall-sync', () => {
			lead();
			return new Promise<void>((release) => this.#cleanup.push(release));
		});
	}

	stop(): void {
		this.#stopped = true;
		this.#cancelRetry?.();
		this.#live?.close();
		this.#live = null;
		for (const c of this.#cleanup.splice(0)) c();
	}

	/** Run a sync now, or once more after the one in flight. */
	wake(): Promise<void> {
		if (this.#stopped || this.#status.kind === 'needs-login') return Promise.resolve();
		if (this.#running) {
			this.#again = true;
			return this.#running;
		}
		this.#cancelRetry?.();
		this.#cancelRetry = null;
		this.#running = (async () => {
			try {
				do {
					this.#again = false;
					await this.#rounds();
				} while (this.#again && this.#status.kind === 'idle');
			} finally {
				this.#running = null;
			}
		})();
		return this.#running;
	}

	async login(password: string): Promise<boolean> {
		const res = await this.#env.fetch(`${this.#base}/api/login`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password }),
			credentials: 'same-origin'
		});
		if (res.status !== 204) return false;
		this.#set({ kind: 'idle', lastOk: null });
		void this.wake();
		return true;
	}

	#retry(): void {
		const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.#attempt++);
		const ms = ceiling * (0.5 + 0.5 * (this.#env.random ?? Math.random)());
		this.#set({ kind: 'offline', retryAt: this.#now() + ms });
		this.#cancelRetry = (this.#env.schedule ?? defaultSchedule)(() => void this.wake(), ms);
	}

	#openLive(): void {
		if (this.#live || !this.#env.live) return;
		this.#live = this.#env.live(`${this.#base}/api/live`);
		this.#live.addEventListener('head', (e) => {
			try {
				const { head } = JSON.parse(e.data) as { head: unknown };
				if (typeof head === 'number' && head > this.#replica.cursor.seq) void this.wake();
			} catch {
				// A malformed event carries nothing to act on.
			}
		});
	}

	async #rounds(): Promise<void> {
		this.#set({ kind: 'syncing' });
		for (;;) {
			const queued = await this.#replica.pending(PUSH_LIMIT);
			const ops = queued.filter((op) => parseOp(op) !== null);
			if (ops.length < queued.length) {
				const bad = queued.filter((op) => parseOp(op) === null);
				console.error('heimdall: dropping ops the server would reject', bad);
				await this.#replica.forget(bad.map((op) => op.hlc));
			}
			const after = this.#replica.cursor.seq;
			let res: Response;
			try {
				res = await this.#env.fetch(`${this.#base}/api/sync`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ after, ops }),
					credentials: 'same-origin'
				});
			} catch {
				return this.#retry();
			}
			if (res.status === 401) {
				this.#live?.close();
				this.#live = null;
				return this.#set({ kind: 'needs-login' });
			}
			if (res.status === 400) {
				const index = ((await res.json().catch(() => null)) as { index?: unknown } | null)?.index;
				const bad = typeof index === 'number' ? ops[index] : undefined;
				if (!bad) return this.#retry();
				console.error('heimdall: the server rejected an op', bad);
				await this.#replica.forget([bad.hlc]);
				continue;
			}
			const body = res.ok ? parseResponse(await res.json().catch(() => null)) : null;
			if (!body) return this.#retry();

			const { epoch } = this.#replica.cursor;
			if (epoch !== null && body.epoch !== epoch) {
				await this.#replica.reseed(body.epoch);
				continue;
			}
			const pulled = body.ops.map((e) => parseOp(e.op)).filter((op) => op !== null);
			await this.#replica.absorb({
				ops: pulled,
				acked: ops.map((op) => op.hlc),
				cursor: body.ops.at(-1)?.seq ?? after,
				epoch: body.epoch
			});
			this.#attempt = 0;
			this.#openLive();
			if (!body.more && (await this.#replica.pending(1)).length === 0) break;
		}
		this.#set({ kind: 'idle', lastOk: this.#now() });
	}
}
