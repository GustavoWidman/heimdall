import type { Change } from '../replica/op';
import { boardOrder, rankBetween } from './board';
import { isCheckInKey, parseCheckInValue, type CheckInPatch } from './checkin';
import { step, type FoldState } from './focus';
import {
	dayStartHour,
	bounceMinutes,
	hue,
	instant,
	note,
	planId,
	taskStatus,
	timeZone,
	title,
	type DayKey,
	type Gesture,
	type Hue,
	type Instant,
	type Mark,
	type MarkId,
	type PlanEntry,
	type Reason,
	type Settings,
	type Task,
	type TaskId,
	type TaskStatus
} from './model';

/**
 * Everything a user can do, as data. Gestures take an optional `at`: absent means now,
 * present means "I forgot to tick, it happened at 14:00". Moving an existing mark is retime.
 * Text and numbers arrive raw from the UI; decide validates them.
 */
export type Intent =
	| { readonly k: 'tap' | 'hold' | 'release'; readonly task: TaskId; readonly at?: Instant }
	| { readonly k: 'rest' | 'off'; readonly at?: Instant }
	| { readonly k: 'tag'; readonly mark: MarkId; readonly reason: Reason | null }
	| { readonly k: 'retime'; readonly mark: MarkId; readonly at: Instant }
	| { readonly k: 'void'; readonly mark: MarkId; readonly voided: boolean }
	| ({ readonly k: 'createTask'; readonly title: string; readonly planFor?: DayKey } & TaskInput)
	| ({ readonly k: 'editTask'; readonly task: TaskId; readonly title?: string } & TaskInput & {
				readonly status?: TaskStatus;
			})
	| { readonly k: 'plan' | 'unplan'; readonly day: DayKey; readonly task: TaskId }
	/** Move a planned task to just before `before`, or to the end when null. */
	| {
			readonly k: 'reorder';
			readonly day: DayKey;
			readonly task: TaskId;
			readonly before: TaskId | null;
	  }
	| {
			readonly k: 'checkIn';
			readonly day: DayKey;
			readonly patch: Readonly<Record<string, unknown>>;
	  }
	| {
			readonly k: 'settings';
			readonly timeZone?: string;
			readonly dayStartHour?: number;
			readonly bounceMinutes?: number;
	  };

type TaskInput = {
	readonly note?: string | null;
	readonly hue?: number;
	readonly deadline?: Instant | null;
	readonly longRunning?: boolean;
};

/** What decide may read. The app builds it from the loaded data. */
export type DecideContext = {
	readonly now: Instant;
	/** The fold state now, from today's view. */
	readonly state: FoldState;
	/** A fresh random id body, `[A-Za-z0-9_-]`. */
	readonly newId: () => string;
	readonly mark: (id: MarkId) => Mark | undefined;
	readonly task: (id: TaskId) => Task | undefined;
	readonly tasks: () => Iterable<Task>;
	/** Every plan entry of a loaded day, on or off. */
	readonly plan: (day: DayKey) => readonly PlanEntry[];
};

export type Rejection = { readonly field: string; readonly problem: string };

export type Decision =
	| { readonly ok: true; readonly changes: readonly Change[] }
	| { readonly ok: false; readonly rejection: Rejection };

const ok = (...changes: Change[]): Decision => ({ ok: true, changes });
const reject = (field: string, problem: string): Decision => ({
	ok: false,
	rejection: { field, problem }
});

const GOLDEN_ANGLE = 137.508;

/** The next task hue, a golden-angle step from the newest task's, so neighbors differ. */
export function nextHue(tasks: Iterable<Task>): Hue {
	let newest: Task | null = null;
	for (const t of tasks) if (!newest || t.createdAt > newest.createdAt) newest = t;
	return (newest ? Math.round(newest.hue + GOLDEN_ANGLE) % 360 : 210) as Hue;
}

function gestureOf(
	intent: Extract<Intent, { k: 'tap' | 'hold' | 'release' | 'rest' | 'off' }>
): Gesture {
	return 'task' in intent ? { k: intent.k, task: intent.task } : { k: intent.k };
}

/**
 * Intent to changes. Pure. An intent that would change nothing returns no changes rather
 * than a rejection, so the tap path has no failure branch: a tap on the task already
 * alone in focus records nothing.
 */
export function decide(ctx: DecideContext, intent: Intent): Decision {
	const clamp = (at: Instant) => Math.min(at, ctx.now) as Instant;
	switch (intent.k) {
		case 'tap':
		case 'hold':
		case 'release':
		case 'rest':
		case 'off': {
			const g = gestureOf(intent);
			if ('task' in g && !ctx.task(g.task)) return reject('task', 'unknown task');
			if (intent.at === undefined && step(ctx.state, g).kind === 'none') return ok();
			const at = intent.at === undefined ? ctx.now : clamp(intent.at);
			const id = `m_${ctx.newId()}` as MarkId;
			return ok({ kind: 'mark', id, set: { at, gesture: g, voided: false, reason: null } });
		}
		case 'tag':
		case 'retime':
		case 'void': {
			if (!ctx.mark(intent.mark)) return reject('mark', 'unknown mark');
			const set =
				intent.k === 'tag'
					? { reason: intent.reason }
					: intent.k === 'retime'
						? { at: clamp(intent.at) }
						: { voided: intent.voided };
			return ok({ kind: 'mark', id: intent.mark, set });
		}
		case 'createTask': {
			const t = title(intent.title);
			if (!t) return reject('title', 'needs 1 to 200 characters');
			const fields = taskFields(intent);
			if (!fields.ok) return fields.decision;
			const id = `t_${ctx.newId()}` as TaskId;
			const changes: Change[] = [
				{
					kind: 'task',
					id,
					set: {
						title: t,
						note: null,
						hue: nextHue(ctx.tasks()),
						deadline: null,
						longRunning: false,
						status: 'active',
						createdAt: ctx.now,
						...fields.set
					}
				}
			];
			if (intent.planFor) changes.push(...planChanges(ctx, intent.planFor, id));
			return ok(...changes);
		}
		case 'editTask': {
			if (!ctx.task(intent.task)) return reject('task', 'unknown task');
			const fields = taskFields(intent);
			if (!fields.ok) return fields.decision;
			const set: { -readonly [F in keyof Partial<Task>]: Task[F] } = { ...fields.set };
			if (intent.title !== undefined) {
				const t = title(intent.title);
				if (!t) return reject('title', 'needs 1 to 200 characters');
				set.title = t;
			}
			if (intent.status !== undefined) {
				const s = taskStatus(intent.status);
				if (!s) return reject('status', 'unknown status');
				set.status = s;
			}
			return Object.keys(set).length ? ok({ kind: 'task', id: intent.task, set }) : ok();
		}
		case 'plan':
			return ok(...planChanges(ctx, intent.day, intent.task));
		case 'unplan': {
			const entry = ctx.plan(intent.day).find((p) => p.task === intent.task);
			if (!entry?.on) return ok();
			return ok({ kind: 'plan', id: planId(intent.day, intent.task), set: { on: false } });
		}
		case 'reorder':
			return reorder(ctx, intent.day, intent.task, intent.before);
		case 'checkIn': {
			const patch: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(intent.patch)) {
				if (!isCheckInKey(key)) return reject(key, 'unknown check-in field');
				if (value !== null && parseCheckInValue(key, value) === undefined) {
					return reject(key, 'value out of range');
				}
				patch[key] = value;
			}
			if (!Object.keys(patch).length) return ok();
			return ok({ kind: 'checkin', id: intent.day, set: patch as CheckInPatch });
		}
		case 'settings': {
			const set: { -readonly [F in keyof Settings]?: Settings[F] } = {};
			if (intent.timeZone !== undefined) {
				const z = timeZone(intent.timeZone);
				if (!z) return reject('timeZone', 'unknown time zone');
				set.timeZone = z;
			}
			if (intent.dayStartHour !== undefined) {
				const h = dayStartHour(intent.dayStartHour);
				if (h === null) return reject('dayStartHour', 'needs a whole hour 0 to 23');
				set.dayStartHour = h;
			}
			if (intent.bounceMinutes !== undefined) {
				const b = bounceMinutes(intent.bounceMinutes);
				if (b === null) return reject('bounceMinutes', 'needs whole minutes 0 to 60');
				set.bounceMinutes = b;
			}
			return Object.keys(set).length ? ok({ kind: 'settings', id: 'user', set }) : ok();
		}
	}
}

type TaskFields = Partial<Pick<Task, 'note' | 'hue' | 'deadline' | 'longRunning'>>;

function taskFields(
	input: TaskInput
): { ok: true; set: TaskFields } | { ok: false; decision: Decision } {
	const set: { -readonly [F in keyof TaskFields]: TaskFields[F] } = {};
	if (input.note !== undefined) {
		const text = input.note?.trim() ? input.note : null;
		if (text !== null && note(text) === null) {
			return { ok: false, decision: reject('note', 'needs at most 4000 characters') };
		}
		set.note = text;
	}
	if (input.hue !== undefined) {
		const h = hue(input.hue);
		if (h === null) return { ok: false, decision: reject('hue', 'needs a whole degree 0 to 359') };
		set.hue = h;
	}
	if (input.deadline !== undefined) {
		const d = input.deadline === null ? null : instant(input.deadline);
		if (input.deadline !== null && d === null) {
			return { ok: false, decision: reject('deadline', 'not a valid instant') };
		}
		set.deadline = d;
	}
	if (input.longRunning !== undefined) set.longRunning = input.longRunning;
	return { ok: true, set };
}

function planChanges(ctx: DecideContext, day: DayKey, task: TaskId): Change[] {
	const entries = ctx.plan(day);
	if (entries.some((p) => p.task === task && p.on)) return [];
	const last = boardOrder(entries).at(-1);
	return [
		{
			kind: 'plan',
			id: planId(day, task),
			set: { on: true, rank: rankBetween(last?.rank ?? null, null) }
		}
	];
}

function reorder(ctx: DecideContext, day: DayKey, task: TaskId, before: TaskId | null): Decision {
	const order = boardOrder(ctx.plan(day));
	if (!order.some((p) => p.task === task)) return reject('task', 'not planned for this day');
	const rest = order.filter((p) => p.task !== task);
	const at = before === null ? rest.length : rest.findIndex((p) => p.task === before);
	if (at < 0) return reject('before', 'not planned for this day');
	try {
		const rank = rankBetween(rest[at - 1]?.rank ?? null, rest[at]?.rank ?? null);
		return ok({ kind: 'plan', id: planId(day, task), set: { rank } });
	} catch {
		// Two neighbours share a rank (concurrent edits on two devices); renumber the whole day.
		const tasks = rest.map((p) => p.task);
		tasks.splice(at, 0, task);
		let prev: string | null = null;
		return ok(
			...tasks.map((t): Change => {
				prev = rankBetween(prev, null);
				return { kind: 'plan', id: planId(day, t), set: { rank: prev } };
			})
		);
	}
}
