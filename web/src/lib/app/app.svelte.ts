import { SvelteSet, createSubscriber } from 'svelte/reactivity';
import { deriveBoard, suggestPlan, type BoardRow, type PlanSuggestions } from '../domain/board';
import type { CheckIn } from '../domain/checkin';
import { decide, type Decision, type Intent } from '../domain/commands';
import {
	CARRY_LOOKBACK_MS,
	byTime,
	carryIn,
	daysTouchedBy,
	deriveDay,
	type DayView
} from '../domain/focus';
import {
	DEFAULT_DAY_START_HOUR,
	timeZone,
	type DayKey,
	type Instant,
	type Mark,
	type MarkId,
	type PlanEntry,
	type Settings,
	type Task,
	type TaskId,
	type TimeZone
} from '../domain/model';
import {
	aggregateDay,
	aggregateDays,
	basisOf,
	insights,
	type DayAggregate,
	type DaySummary,
	type Insights
} from '../domain/stats';
import { addDays, dayOf, daysBetween, rangeOf } from '../domain/time';
import { parseEntity, type Kind, type Rec } from '../replica/op';
import { Replica } from '../replica/replica.svelte';
import type { Touched } from '../replica/store';
import { Sync, type SyncEnv, type SyncStatus } from '../replica/sync';

export type { BoardRow, PlanSuggestions } from '../domain/board';
export type { CheckIn, CheckInKey, FieldDef } from '../domain/checkin';
export { CHECKIN_FIELDS, CHECKIN_KEYS } from '../domain/checkin';
export type { Decision, Intent } from '../domain/commands';
export type { DayView, Segment, Transition, TransitionKind } from '../domain/focus';
export type {
	DayKey,
	Focus,
	Instant,
	Mark,
	MarkId,
	Reason,
	Task,
	TaskId,
	TaskStatus
} from '../domain/model';
export { REASONS, dayKey } from '../domain/model';
export { addDays } from '../domain/time';
export type { DaySummary, Insights } from '../domain/stats';
export type { SyncStatus } from '../replica/sync';

/** A day ready to show: its timeline, board, check-in, and every mark for the edit list. */
export type DayData = {
	readonly day: DayKey;
	readonly view: DayView;
	readonly board: readonly BoardRow[];
	readonly checkIn: CheckIn;
	/** Every mark of the day, voided ones included, in timeline order. */
	readonly marks: readonly Mark[];
};

export type TodayData = DayData & {
	/** What to offer when building the day's board. */
	readonly suggestions: PlanSuggestions;
};

/** Everything stored on this device, parsed, for a person to keep as a file. */
export type Export = {
	readonly format: 'heimdall-export';
	readonly version: 1;
	readonly exportedAt: string;
	readonly settings: Settings;
	readonly tasks: readonly Task[];
	readonly marks: readonly Mark[];
	readonly plans: readonly PlanEntry[];
	readonly checkIns: readonly { readonly day: DayKey; readonly values: CheckIn }[];
};

export type DayPage = { readonly status: 'loading' } | ({ readonly status: 'ready' } & DayData);

export type AppDeps = {
	readonly dbName?: string;
	readonly idb?: IDBFactory;
	readonly now?: () => number;
	/** The zone used until one is replicated, and the one written after the first sync. */
	readonly deviceZone: string;
	readonly newId: () => string;
	readonly channel: BroadcastChannel | null;
	readonly sync: Omit<SyncEnv, 'onStatus'>;
	readonly timers?: {
		readonly every: (run: () => void, ms: number) => () => void;
		/** Gives the main thread back between slices of aggregate recomputation. */
		readonly yieldToMain: () => Promise<void>;
	};
};

const SLICE_MS = 4;

const defaultTimers = {
	every(run: () => void, ms: number) {
		const id = setInterval(run, ms);
		return () => clearInterval(id);
	},
	yieldToMain: () => new Promise<void>((resolve) => setTimeout(resolve, 0))
};

/**
 * The one module routes import. Reactive reads (`today`, `day`, `tasks`, `settings`,
 * `sync`, `now`) and one write (`do`). Behind it sit HLCs, ops, merge, IndexedDB, the
 * outbox, which days are loaded, the aggregate cache, the sync loop, and auth state.
 */
export class App {
	readonly #replica: Replica;
	readonly #sync: Sync;
	readonly #deps: AppDeps;
	readonly #now: () => number;
	readonly #timers: NonNullable<AppDeps['timers']>;
	readonly #loaded = new SvelteSet<string>();
	readonly #loading = new Map<string, Promise<void>>();
	readonly #stop: (() => void)[] = [];
	#status = $state<SyncStatus>({ kind: 'idle', lastOk: null });
	#minute = $state(0);
	readonly #subscribeNow = createSubscriber((update) => this.#timers.every(update, 1000));

	readonly settings: Settings = $derived.by(() => {
		const rec = this.#replica.mirror.settings.get('user');
		const s = rec ? parseEntity('settings', rec) : null;
		return {
			timeZone: s?.timeZone ?? timeZone(this.#deps.deviceZone) ?? ('UTC' as TimeZone),
			dayStartHour: s?.dayStartHour ?? DEFAULT_DAY_START_HOUR
		};
	});

	readonly #taskMap: ReadonlyMap<TaskId, Task> = $derived.by(() => {
		const out = new Map<TaskId, Task>();
		for (const rec of this.#replica.mirror.task.values()) {
			const t = parseEntity('task', rec);
			if (t) out.set(t.id, t);
		}
		return out;
	});

	/** Every task, every status, oldest first. */
	readonly tasks: readonly Task[] = $derived(
		[...this.#taskMap.values()].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
	);

	readonly #marks: readonly Mark[] = $derived.by(() => {
		const out: Mark[] = [];
		for (const rec of this.#replica.mirror.mark.values()) {
			const m = parseEntity('mark', rec);
			if (m) out.push(m);
		}
		return out.sort(byTime);
	});

	readonly #todayKey: DayKey = $derived.by(() => {
		void this.#minute;
		return dayOf(this.#now() as Instant, this.settings);
	});

	/** Always computable from what is loaded; a new day or new settings load in behind it. */
	readonly today: TodayData = $derived.by(() => {
		const key = this.#todayKey;
		if (!this.#loaded.has(this.#loadKey(key))) queueMicrotask(() => void this.#ensure(key));
		return {
			...this.#compute(key, true),
			suggestions: suggestPlan(this.#taskMap, this.#planOf(key), this.#planOf(addDays(key, -1)))
		};
	});

	private constructor(replica: Replica, deps: AppDeps) {
		this.#replica = replica;
		this.#deps = deps;
		this.#now = deps.now ?? Date.now;
		this.#timers = deps.timers ?? defaultTimers;
		this.#sync = new Sync(replica, { ...deps.sync, onStatus: (s) => this.#onStatus(s) });
	}

	static async open(deps: AppDeps): Promise<App> {
		let app: App | null = null;
		const replica = await Replica.open({
			name: deps.dbName,
			factory: deps.idb,
			now: deps.now,
			channel: deps.channel,
			invalidate: (t) => (app ? app.#invalidate(t) : [])
		});
		app = new App(replica, deps);
		await Promise.all([replica.loadAll('task'), replica.loadAll('settings')]);
		await Promise.all([app.#ensure(app.#todayKey), app.#ensure(addDays(app.#todayKey, -1))]);
		app.#stop.push(app.#timers.every(() => app.#minute++, 60_000));
		app.#sync.start();
		return app;
	}

	close(): void {
		for (const stop of this.#stop.splice(0)) stop();
		this.#sync.stop();
		this.#replica.close();
	}

	/** The current instant. Reading it ticks once a second, only while something reads it. */
	get now(): Instant {
		this.#subscribeNow();
		return this.#now() as Instant;
	}

	get sync(): SyncStatus {
		return this.#status;
	}

	#onStatus(status: SyncStatus): void {
		this.#status = status;
		const rec = this.#replica.mirror.settings.get('user');
		if (status.kind === 'idle' && status.lastOk !== null && !rec?.regs.timeZone) {
			this.do({ k: 'settings', timeZone: this.#deps.deviceZone });
		}
	}

	#invalidate(t: Touched): string[] {
		if (t.kind !== 'mark') return [];
		const days = new Set<string>();
		for (const rec of [t.prev, t.next]) {
			const at = rec?.regs.at?.v;
			if (typeof at === 'number')
				for (const d of daysTouchedBy(at as Instant, this.settings)) days.add(d);
		}
		return [...days];
	}

	#loadKey(day: DayKey): string {
		return `${basisOf(this.settings)}|${day}`;
	}

	/** Bring a day's marks (with its lookback), plans, and check-in into the mirror. */
	#ensure(day: DayKey): Promise<void> {
		const key = this.#loadKey(day);
		let p = this.#loading.get(key);
		if (!p) {
			const range = rangeOf(day, this.settings);
			p = Promise.all([
				this.#replica.loadIndex('mark', range.start - CARRY_LOOKBACK_MS, range.end),
				this.#replica.loadKeys('plan', `${day}:`, `${day};`),
				this.#replica.loadKeys('checkin', day, `${day}\u0000`)
			]).then(() => {
				this.#loaded.add(key);
			});
			this.#loading.set(key, p);
		}
		return p;
	}

	#planOf(day: DayKey): PlanEntry[] {
		const out: PlanEntry[] = [];
		for (const [id, rec] of this.#replica.mirror.plan) {
			if (!id.startsWith(`${day}:`)) continue;
			const p = parseEntity('plan', rec);
			if (p) out.push(p);
		}
		return out;
	}

	#checkInOf(day: DayKey): CheckIn {
		const rec = this.#replica.mirror.checkin.get(day);
		return (rec && parseEntity('checkin', rec)?.values) || {};
	}

	#compute(day: DayKey, live: boolean): DayData {
		const range = rangeOf(day, this.settings);
		const all = this.#marks;
		const inWindow = all.filter((m) => m.at >= range.start - CARRY_LOOKBACK_MS && m.at < range.end);
		const view = deriveDay(inWindow, range, carryIn(inWindow, range.start), live);
		void this.#minute;
		return {
			day,
			view,
			board: deriveBoard(this.#taskMap, this.#planOf(day), view, this.#now() as Instant),
			checkIn: this.#checkInOf(day),
			marks: inWindow.filter((m) => m.at >= range.start)
		};
	}

	/**
	 * A day's data, reactive. Reports loading and starts the load on first read. Callers
	 * memoize with `$derived(app.day(key))`.
	 */
	day(key: DayKey): DayPage {
		if (!this.#loaded.has(this.#loadKey(key))) {
			queueMicrotask(() => void this.#ensure(key));
			return { status: 'loading' };
		}
		return { status: 'ready', ...this.#compute(key, key === this.#todayKey) };
	}

	/**
	 * Per-day summaries from `from` to `to` (inclusive, up to today). Closed days come from the
	 * aggregate cache; missing or stale rows are recomputed in slices of about 4 ms and stored.
	 * Today is computed live and never cached.
	 */
	async range(from: DayKey, to: DayKey): Promise<DaySummary[]> {
		const s = this.settings;
		const basis = basisOf(s);
		const today = this.#todayKey;
		const days = daysBetween(from, to < today ? to : today);
		const cached = await this.#replica.store.aggregates<DayAggregate>(days);
		const byDay = new Map<DayKey, DayAggregate>();
		const stale: DayKey[] = [];
		days.forEach((d, i) => {
			const row = cached[i];
			if (d === today) return;
			if (row && row.basis === basis) byDay.set(d, row);
			else stale.push(d);
		});
		for (const agg of await this.#recompute(stale, s)) byDay.set(agg.day, agg);
		if (days.at(-1) === today) {
			byDay.set(today, aggregateDay(this.today.view, s, this.#now() as Instant));
		}
		const checkIns = await this.#replica.store.read('checkin', { lo: from, hi: `${to}\u0000` });
		const checkInByDay = new Map(
			checkIns.map((rec: Rec) => [rec.id, parseEntity('checkin', rec)?.values ?? {}])
		);
		return days.flatMap((d) => {
			const agg = byDay.get(d);
			return agg ? [{ agg, checkIn: checkInByDay.get(d) ?? {} }] : [];
		});
	}

	async #recompute(days: readonly DayKey[], s: Settings): Promise<DayAggregate[]> {
		if (days.length === 0) return [];
		const { aggGen } = await this.#replica.store.meta();
		const lo = rangeOf(days[0], s).start - CARRY_LOOKBACK_MS;
		const hi = rangeOf(days[days.length - 1], s).end;
		const recs = await this.#replica.store.read('mark', { lo, hi, index: true });
		const marks = recs
			.map((r) => parseEntity('mark', r))
			.filter((m) => m !== null)
			.sort(byTime);
		const out: DayAggregate[] = [];
		let sliceStart = performance.now();
		for (const agg of aggregateDays(marks, days, s)) {
			out.push(agg);
			if (performance.now() - sliceStart > SLICE_MS) {
				await this.#timers.yieldToMain();
				sliceStart = performance.now();
			}
		}
		await this.#replica.store.putAggregates(out, aggGen);
		return out;
	}

	/** Insights over the last `days` days, today included. */
	async insights(days: number): Promise<Insights> {
		const today = this.#todayKey;
		return insights(await this.range(addDays(today, 1 - days), today));
	}

	/** The only write. The views above see the change before the next paint. */
	do(intent: Intent): Decision {
		const decision = decide(
			{
				now: this.#now() as Instant,
				state: this.today.view.state,
				newId: this.#deps.newId,
				mark: (id: MarkId) => {
					const rec = this.#replica.mirror.mark.get(id);
					return rec ? (parseEntity('mark', rec) ?? undefined) : undefined;
				},
				task: (id) => this.#taskMap.get(id),
				tasks: () => this.#taskMap.values(),
				plan: (day) => this.#planOf(day)
			},
			intent
		);
		if (decision.ok && decision.changes.length) this.#replica.commit(decision.changes);
		return decision;
	}

	login(password: string): Promise<boolean> {
		return this.#sync.login(password);
	}

	/** Ends the session; the next sync round sees it and reports needs-login. */
	async logout(): Promise<void> {
		const { fetch, base = '' } = this.#deps.sync;
		await fetch(`${base}/api/logout`, { method: 'POST', credentials: 'same-origin' });
		await this.#sync.wake();
	}

	/** Every record of every kind on this device, not only what is loaded. */
	async export(): Promise<Export> {
		const all = <K extends Kind>(kind: K) =>
			this.#replica.store
				.read(kind)
				.then((recs) => recs.map((r) => parseEntity(kind, r)).filter((e) => e !== null));
		const [tasks, marks, plans, checkIns] = await Promise.all([
			all('task'),
			all('mark'),
			all('plan'),
			all('checkin')
		]);
		return {
			format: 'heimdall-export',
			version: 1,
			exportedAt: new Date(this.#now()).toISOString(),
			settings: this.settings,
			tasks,
			marks: marks.sort(byTime),
			plans,
			checkIns
		};
	}

	/** Resolves once every local write so far is durable on this device. */
	flushed(): Promise<void> {
		return this.#replica.flushed();
	}
}

function randomId(): string {
	return crypto.randomUUID().replaceAll('-', '');
}

/** The app wired to this browser: IndexedDB, fetch, live events, tab election, and timers. */
export function openApp(): Promise<App> {
	return App.open({
		deviceZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		newId: randomId,
		channel: typeof BroadcastChannel === 'function' ? new BroadcastChannel('heimdall') : null,
		sync: {
			fetch: (input, init) => fetch(input, init),
			live: (url) => new EventSource(url, { withCredentials: true }),
			locks: typeof navigator !== 'undefined' ? (navigator.locks ?? null) : null,
			events: typeof window !== 'undefined' ? window : null,
			isVisible: () => document.visibilityState === 'visible'
		}
	});
}
