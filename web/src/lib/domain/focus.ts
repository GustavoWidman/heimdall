import {
	OFF,
	REST,
	TaskSet,
	sameFocus,
	type DayKey,
	type Focus,
	type Gesture,
	type Instant,
	type Mark,
	type MarkId,
	type Reason,
	type Settings,
	type TaskId
} from './model';
import { addDays, dayOf, daysFrom, type DayRange } from './time';

type Working = Extract<Focus, { k: 'working' }>;
type Resting = Extract<Focus, { k: 'rest' }>;
type Off = Extract<Focus, { k: 'off' }>;

/**
 * The fold's state. `held` is the set held before the latest rest, which is what makes
 * "a, rest, a" a resume and "a, rest, b" a switch. It exists only while resting.
 */
export type FoldState =
	| { readonly focus: Working | Off; readonly held: null }
	| { readonly focus: Resting; readonly held: TaskSet | null };

export const FOLD_START: FoldState = { focus: OFF, held: null };

/**
 * What one gesture did.
 * start: first task after off. switch: a task entered (counted). resume: back to a task
 * held before the rest. narrow: the set shrank. rest, off: as named. none: no change.
 */
export type TransitionKind = 'start' | 'switch' | 'resume' | 'narrow' | 'rest' | 'off' | 'none';

export type StepResult = {
	readonly next: FoldState;
	readonly kind: TransitionKind;
	/** The task that entered the working set. Non-null exactly for start, switch, resume. */
	readonly entered: TaskId | null;
};

function working(tasks: TaskSet): FoldState {
	return { focus: { k: 'working', tasks }, held: null };
}

const unchanged = (state: FoldState): StepResult => ({ next: state, kind: 'none', entered: null });

/** The switching model. Total over every state and gesture. */
export function step(state: FoldState, g: Gesture): StepResult {
	const f = state.focus;
	switch (g.k) {
		case 'tap':
		case 'hold': {
			if (f.k === 'working') {
				if (TaskSet.has(f.tasks, g.task)) {
					if (g.k === 'hold' || f.tasks.length === 1) return unchanged(state);
					return { next: working(TaskSet.of(g.task)), kind: 'narrow', entered: null };
				}
				const tasks = g.k === 'tap' ? TaskSet.of(g.task) : TaskSet.with(f.tasks, g.task);
				return { next: working(tasks), kind: 'switch', entered: g.task };
			}
			const next = working(TaskSet.of(g.task));
			if (f.k === 'rest' && state.held) {
				const kind = TaskSet.has(state.held, g.task) ? 'resume' : 'switch';
				return { next, kind, entered: g.task };
			}
			return { next, kind: 'start', entered: g.task };
		}
		case 'release': {
			if (f.k !== 'working' || !TaskSet.has(f.tasks, g.task)) return unchanged(state);
			const left = TaskSet.without(f.tasks, g.task);
			if (left) return { next: working(left), kind: 'narrow', entered: null };
			return { next: { focus: REST, held: f.tasks }, kind: 'rest', entered: null };
		}
		case 'rest':
			if (f.k !== 'working') return unchanged(state);
			return { next: { focus: REST, held: f.tasks }, kind: 'rest', entered: null };
		case 'off':
			if (f.k === 'off') return unchanged(state);
			return { next: FOLD_START, kind: 'off', entered: null };
	}
}

/** Marks sort by `at`, then id, so every device derives the same timeline. */
export function byTime(a: Mark, b: Mark): number {
	return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * How far back a day looks for the focus carried into it. Focus left open longer than
 * this with no new mark reads as off at the next day start.
 */
export const CARRY_LOOKBACK_MS = 24 * 3_600_000;

/** When the focus held at `start` began: its last change in the lookback window. */
function carriedSince(marks: readonly Mark[], start: Instant): Instant {
	let state = FOLD_START;
	let since = start;
	for (const m of marks
		.filter((m) => !m.voided && m.at >= start - CARRY_LOOKBACK_MS && m.at < start)
		.sort(byTime)) {
		const next = step(state, m.gesture).next;
		if (!sameFocus(state.focus, next.focus)) since = m.at as Instant;
		state = next;
	}
	return since;
}

/** The fold state at `start`, from the marks of the lookback window before it. */
export function carryIn(marks: readonly Mark[], start: Instant): FoldState {
	const from = start - CARRY_LOOKBACK_MS;
	let state = FOLD_START;
	for (const m of marks.filter((m) => !m.voided && m.at >= from && m.at < start).sort(byTime)) {
		state = step(state, m.gesture).next;
	}
	return state;
}

/**
 * Days whose derivation reads a mark at `at`: its own day, and each day whose lookback
 * window reaches back to it. Usually the day and the next; a 23-hour day can add one more.
 */
export function daysTouchedBy(at: Instant, s: Settings): DayKey[] {
	const first = dayOf(at, s);
	const last = dayOf((at + CARRY_LOOKBACK_MS) as Instant, s);
	const out: DayKey[] = [];
	for (let i = 0, n = daysFrom(first, last); i <= n; i++) out.push(addDays(first, i));
	return out;
}

export type Transition = {
	readonly mark: MarkId;
	readonly at: Instant;
	readonly gesture: Gesture;
	readonly kind: TransitionKind;
	readonly from: Focus;
	readonly to: Focus;
	readonly entered: TaskId | null;
	readonly reason: Reason | null;
};

/** A stretch of one focus. `mark` began it; null for the stretch carried in at day start. */
export type Segment = {
	readonly start: Instant;
	readonly end: Instant;
	readonly focus: Focus;
	readonly mark: MarkId | null;
};

export type Tail = {
	readonly start: Instant;
	/** When the focus held now began: `start`, or earlier when it carried over from before the day start. */
	readonly since: Instant;
	readonly focus: Focus;
	readonly mark: MarkId | null;
};

export type TaskDay = {
	/** Starts, switches, and resumes into this task. */
	readonly ticks: number;
	/** Switches into this task. */
	readonly switchesIn: number;
	/** Time with this task in the working set. Every task in a juggle accrues full time. */
	readonly ms: number;
};

export type Totals = {
	/** One or more tasks held. */
	readonly focusMs: number;
	/** Two or more tasks held. */
	readonly juggleMs: number;
	readonly restMs: number;
};

export type DayView = {
	readonly range: DayRange;
	readonly carry: FoldState;
	/** Contiguous from range.start up to the tail (live day) or range.end (closed day). */
	readonly segments: readonly Segment[];
	/** The open stretch of a live day. Timers add `now - tail.start` themselves. */
	readonly tail: Tail | null;
	/** One per non-voided mark in the day, in timeline order. */
	readonly transitions: readonly Transition[];
	readonly switches: number;
	readonly ticks: number;
	/** Closed time only; see liveTotals for the running values. */
	readonly perTask: ReadonlyMap<TaskId, TaskDay>;
	readonly totals: Totals;
	readonly lastSwitch: Transition | null;
	/** The fold state after the last mark, which is the state now on a live day. */
	readonly state: FoldState;
};

type MutableTaskDay = { ticks: number; switchesIn: number; ms: number };

function taskDay(perTask: Map<TaskId, MutableTaskDay>, task: TaskId): MutableTaskDay {
	let d = perTask.get(task);
	if (!d) {
		d = { ticks: 0, switchesIn: 0, ms: 0 };
		perTask.set(task, d);
	}
	return d;
}

function accrue(
	perTask: Map<TaskId, MutableTaskDay>,
	totals: { focusMs: number; juggleMs: number; restMs: number },
	focus: Focus,
	ms: number
): void {
	if (focus.k === 'rest') totals.restMs += ms;
	if (focus.k !== 'working') return;
	totals.focusMs += ms;
	if (focus.tasks.length > 1) totals.juggleMs += ms;
	for (const t of focus.tasks) taskDay(perTask, t).ms += ms;
}

/**
 * Derive one day. Pure. `marks` may hold any marks, voided or not, in any order; only
 * the non-voided ones inside the range count. `carry` comes from carryIn.
 * `live` keeps the last stretch open as the tail instead of closing it at range.end.
 */
export function deriveDay(
	marks: readonly Mark[],
	range: DayRange,
	carry: FoldState,
	live: boolean
): DayView {
	const inDay = marks
		.filter((m) => !m.voided && m.at >= range.start && m.at < range.end)
		.sort(byTime);
	const segments: Segment[] = [];
	const transitions: Transition[] = [];
	const perTask = new Map<TaskId, MutableTaskDay>();
	const totals = { focusMs: 0, juggleMs: 0, restMs: 0 };
	let state = carry;
	let cursor = range.start;
	let segMark: MarkId | null = null;
	let switches = 0;
	let ticks = 0;
	let lastSwitch: Transition | null = null;

	if (carry.focus.k === 'working') for (const t of carry.focus.tasks) taskDay(perTask, t);

	for (const m of inDay) {
		const r = step(state, m.gesture);
		const t: Transition = {
			mark: m.id,
			at: m.at,
			gesture: m.gesture,
			kind: r.kind,
			from: state.focus,
			to: r.next.focus,
			entered: r.entered,
			reason: m.reason
		};
		transitions.push(t);
		if (r.entered) {
			ticks++;
			const d = taskDay(perTask, r.entered);
			d.ticks++;
			if (r.kind === 'switch') {
				d.switchesIn++;
				switches++;
				lastSwitch = t;
			}
		}
		if (!sameFocus(state.focus, r.next.focus)) {
			if (m.at > cursor) {
				segments.push({ start: cursor, end: m.at, focus: state.focus, mark: segMark });
				accrue(perTask, totals, state.focus, m.at - cursor);
			}
			cursor = m.at;
			segMark = m.id;
		}
		state = r.next;
	}

	let tail: Tail | null = null;
	if (live) {
		const since = segMark === null ? carriedSince(marks, range.start) : cursor;
		tail = { start: cursor, since, focus: state.focus, mark: segMark };
	} else if (range.end > cursor) {
		segments.push({ start: cursor, end: range.end, focus: state.focus, mark: segMark });
		accrue(perTask, totals, state.focus, range.end - cursor);
	}

	return {
		range,
		carry,
		segments,
		tail,
		transitions,
		switches,
		ticks,
		perTask,
		totals,
		lastSwitch,
		state
	};
}

/** Focus at an instant of the day. */
export function focusAt(view: DayView, at: Instant): Focus {
	if (view.tail && at >= view.tail.start) return view.tail.focus;
	const segs = view.segments;
	if (segs.length === 0) return view.carry.focus;
	let lo = 0;
	let hi = segs.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (segs[mid].start <= at) lo = mid;
		else hi = mid - 1;
	}
	return segs[lo].focus;
}

/** Closed totals plus the open tail up to `now`, clipped to the day. */
export function liveTotals(
	view: DayView,
	now: Instant
): Totals & { readonly perTask: ReadonlyMap<TaskId, TaskDay> } {
	const totals = { ...view.totals };
	const perTask = new Map<TaskId, MutableTaskDay>();
	for (const [t, d] of view.perTask) perTask.set(t, { ...d });
	if (view.tail) {
		const ms = Math.min(now, view.range.end) - view.tail.start;
		if (ms > 0) accrue(perTask, totals, view.tail.focus, ms);
	}
	return { ...totals, perTask };
}
