declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Milliseconds since the Unix epoch. */
export type Instant = Brand<number, 'Instant'>;
/** A heimdall day, `YYYY-MM-DD`. Which instants it covers depends on Settings. */
export type DayKey = Brand<string, 'DayKey'>;
export type TaskId = Brand<string, 'TaskId'>;
export type MarkId = Brand<string, 'MarkId'>;
/** Integer 0..359. */
export type Hue = Brand<number, 'Hue'>;
/** An IANA zone name that Intl accepts. */
export type TimeZone = Brand<string, 'TimeZone'>;
/** Integer 0..23, the local hour at which a day begins. */
export type DayStartHour = Brand<number, 'DayStartHour'>;
/** Trimmed, 1..200 characters. */
export type Title = Brand<string, 'Title'>;
/** Sorted, duplicate-free, non-empty. Equal sets are element-wise equal arrays. */
export type TaskSet = Brand<readonly [TaskId, ...TaskId[]], 'TaskSet'>;

const ENTITY_ID = /^[A-Za-z0-9_-]{1,100}$/;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function instant(json: unknown): Instant | null {
	return typeof json === 'number' && Number.isSafeInteger(json) && json >= 0
		? (json as Instant)
		: null;
}

export function dayKey(json: unknown): DayKey | null {
	if (typeof json !== 'string') return null;
	const m = DAY_KEY.exec(json);
	if (!m) return null;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return d.toISOString().slice(0, 10) === json ? (json as DayKey) : null;
}

/** Ids are opaque; they exclude `:` so a plan id `${day}:${task}` splits unambiguously. */
export function taskId(json: unknown): TaskId | null {
	return typeof json === 'string' && ENTITY_ID.test(json) ? (json as TaskId) : null;
}

export function markId(json: unknown): MarkId | null {
	return typeof json === 'string' && ENTITY_ID.test(json) ? (json as MarkId) : null;
}

export function hue(json: unknown): Hue | null {
	return typeof json === 'number' && Number.isInteger(json) && json >= 0 && json < 360
		? (json as Hue)
		: null;
}

const zones = new Map<string, boolean>();
export function timeZone(json: unknown): TimeZone | null {
	if (typeof json !== 'string' || json.length === 0) return null;
	let ok = zones.get(json);
	if (ok === undefined) {
		try {
			new Intl.DateTimeFormat('en-US', { timeZone: json });
			ok = true;
		} catch {
			ok = false;
		}
		zones.set(json, ok);
	}
	return ok ? (json as TimeZone) : null;
}

export function dayStartHour(json: unknown): DayStartHour | null {
	return typeof json === 'number' && Number.isInteger(json) && json >= 0 && json <= 23
		? (json as DayStartHour)
		: null;
}

export function title(json: unknown): Title | null {
	if (typeof json !== 'string') return null;
	const t = json.trim();
	return t.length >= 1 && t.length <= 200 ? (t as Title) : null;
}

export const TaskSet = {
	of(task: TaskId): TaskSet {
		return [task] as unknown as TaskSet;
	},
	/** Sorts and dedupes; null when empty. */
	from(tasks: readonly TaskId[]): TaskSet | null {
		const sorted = [...new Set(tasks)].sort();
		return sorted.length === 0 ? null : (sorted as unknown as TaskSet);
	},
	has(set: TaskSet, task: TaskId): boolean {
		return set.includes(task);
	},
	with(set: TaskSet, task: TaskId): TaskSet {
		return TaskSet.from([...set, task]) as TaskSet;
	},
	without(set: TaskSet, task: TaskId): TaskSet | null {
		return TaskSet.from(set.filter((t) => t !== task));
	},
	equals(a: TaskSet, b: TaskSet): boolean {
		return a.length === b.length && a.every((t, i) => t === b[i]);
	}
};

/** What the user holds at a moment. `off` means not tracking: asleep, day over. */
export type Focus =
	| { readonly k: 'off' }
	| { readonly k: 'rest' }
	| { readonly k: 'working'; readonly tasks: TaskSet };

export const OFF: Focus = { k: 'off' };
export const REST: Focus = { k: 'rest' };

export function sameFocus(a: Focus, b: Focus): boolean {
	if (a.k === 'working' && b.k === 'working') return TaskSet.equals(a.tasks, b.tasks);
	return a.k === b.k;
}

/**
 * What the user did. tap = this task alone, hold = add it to the set,
 * release = drop it from the set. A mark stores the gesture, never the resulting set,
 * so voiding or retiming one mark re-derives every later moment.
 */
export type Gesture =
	| { readonly k: 'tap'; readonly task: TaskId }
	| { readonly k: 'hold'; readonly task: TaskId }
	| { readonly k: 'release'; readonly task: TaskId }
	| { readonly k: 'rest' }
	| { readonly k: 'off' };

export function gesture(json: unknown): Gesture | null {
	if (typeof json !== 'object' || json === null) return null;
	const g = json as { k?: unknown; task?: unknown };
	switch (g.k) {
		case 'tap':
		case 'hold':
		case 'release': {
			const task = taskId(g.task);
			return task ? { k: g.k, task } : null;
		}
		case 'rest':
		case 'off':
			return { k: g.k };
		default:
			return null;
	}
}

export const REASONS = ['done', 'blocked', 'urge', 'pulled'] as const;
export type Reason = (typeof REASONS)[number];

export function reason(json: unknown): Reason | null {
	return (REASONS as readonly unknown[]).includes(json) ? (json as Reason) : null;
}

export type Mark = {
	readonly id: MarkId;
	/** When it happened, as the user says. A retime writes a new `at`. */
	readonly at: Instant;
	readonly gesture: Gesture;
	readonly voided: boolean;
	readonly reason: Reason | null;
};

export const TASK_STATUSES = ['active', 'done', 'archived'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function taskStatus(json: unknown): TaskStatus | null {
	return (TASK_STATUSES as readonly unknown[]).includes(json) ? (json as TaskStatus) : null;
}

/** A task lives across many days. It is never deleted, because marks reference it. */
export type Task = {
	readonly id: TaskId;
	readonly title: Title;
	readonly note: string | null;
	readonly hue: Hue;
	readonly deadline: Instant | null;
	readonly longRunning: boolean;
	readonly status: TaskStatus;
	readonly createdAt: Instant;
};

export const NOTE_MAX = 4000;

export function note(json: unknown): string | null {
	return typeof json === 'string' && json.length <= NOTE_MAX ? json : null;
}

/** A task on a day's board. `rank` orders the board by hand; rows never move on their own. */
export type PlanEntry = {
	readonly day: DayKey;
	readonly task: TaskId;
	readonly on: boolean;
	readonly rank: string;
};

export function planId(day: DayKey, task: TaskId): string {
	return `${day}:${task}`;
}

export function parsePlanId(id: string): { day: DayKey; task: TaskId } | null {
	const i = id.indexOf(':');
	const day = dayKey(id.slice(0, i));
	const task = taskId(id.slice(i + 1));
	return i > 0 && day && task ? { day, task } : null;
}

/** Replicated, so every device buckets marks into the same days. */
export type Settings = {
	readonly timeZone: TimeZone;
	readonly dayStartHour: DayStartHour;
};

export const DEFAULT_DAY_START_HOUR = 4 as DayStartHour;
