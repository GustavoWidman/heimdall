import type { DayView, TaskDay } from './focus';
import { TaskSet, type Instant, type PlanEntry, type Task, type TaskId } from './model';

/** How close a deadline is. Shown as a chip; it never reorders the board. */
export type Pressure = 'none' | 'overdue' | 'today' | 'soon' | 'week' | 'later';

const HOUR = 3_600_000;

export function pressure(deadline: Instant | null, now: Instant): Pressure {
	if (deadline === null) return 'none';
	const left = deadline - now;
	if (left < 0) return 'overdue';
	if (left < 24 * HOUR) return 'today';
	if (left < 72 * HOUR) return 'soon';
	if (left < 7 * 24 * HOUR) return 'week';
	return 'later';
}

export type BoardRow = {
	readonly task: Task;
	/** False for a task touched today without being planned. */
	readonly planned: boolean;
	readonly day: TaskDay;
	readonly inFocus: boolean;
	readonly pressure: Pressure;
};

const NO_TIME: TaskDay = { ticks: 0, switchesIn: 0, ms: 0 };

/** Plan entries that are on, in board order: rank, then task id for equal ranks. */
export function boardOrder(plan: readonly PlanEntry[]): PlanEntry[] {
	return plan
		.filter((p) => p.on)
		.sort((a, b) =>
			a.rank !== b.rank
				? a.rank < b.rank
					? -1
					: 1
				: a.task < b.task
					? -1
					: a.task > b.task
						? 1
						: 0
		);
}

/**
 * A day's board: planned tasks in their manual order, then tasks touched that day but not
 * planned, in the order they were first touched.
 */
export function deriveBoard(
	tasks: ReadonlyMap<TaskId, Task>,
	plan: readonly PlanEntry[],
	view: DayView,
	now: Instant
): BoardRow[] {
	const focus = view.state.focus;
	const row = (task: Task, planned: boolean): BoardRow => ({
		task,
		planned,
		day: view.perTask.get(task.id) ?? NO_TIME,
		inFocus: focus.k === 'working' && TaskSet.has(focus.tasks, task.id),
		pressure: pressure(task.deadline, now)
	});
	const rows: BoardRow[] = [];
	const seen = new Set<TaskId>();
	for (const p of boardOrder(plan)) {
		const task = tasks.get(p.task);
		if (!task || seen.has(p.task)) continue;
		seen.add(p.task);
		rows.push(row(task, true));
	}
	for (const id of view.perTask.keys()) {
		const task = tasks.get(id);
		if (!task || seen.has(id)) continue;
		seen.add(id);
		rows.push(row(task, false));
	}
	return rows;
}

export type PlanSuggestions = {
	/** Planned the day before, still active, not yet planned today. */
	readonly carryOver: readonly Task[];
	/** Long-running active tasks on neither list. */
	readonly backlog: readonly Task[];
};

export function suggestPlan(
	tasks: ReadonlyMap<TaskId, Task>,
	today: readonly PlanEntry[],
	yesterday: readonly PlanEntry[]
): PlanSuggestions {
	const planned = new Set(boardOrder(today).map((p) => p.task));
	const carryOver: Task[] = [];
	for (const p of boardOrder(yesterday)) {
		const task = tasks.get(p.task);
		if (task && task.status === 'active' && !planned.has(task.id)) carryOver.push(task);
	}
	const offered = new Set(carryOver.map((t) => t.id));
	const backlog = [...tasks.values()]
		.filter(
			(t) => t.status === 'active' && t.longRunning && !planned.has(t.id) && !offered.has(t.id)
		)
		.sort(
			(a, b) =>
				(a.deadline ?? Infinity) - (b.deadline ?? Infinity) ||
				a.createdAt - b.createdAt ||
				(a.id < b.id ? -1 : 1)
		);
	return { carryOver, backlog };
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A rank strictly between `a` and `b` (null = open end), for manual order. Ranks compare
 * as plain strings. Trailing '0's carry no value, so `a0` and `a` are the same position.
 * Throws when the two are not in order, which equal ranks from concurrent edits can cause.
 */
export function rankBetween(a: string | null, b: string | null): string {
	const lo = a === null ? '' : a.replace(/0+$/, '');
	const hi = b === null ? null : b.replace(/0+$/, '');
	if (!/^[0-9a-z]*$/.test(lo) || (hi !== null && (!/^[0-9a-z]+$/.test(hi) || lo >= hi))) {
		throw new RangeError(`no rank between ${a} and ${b}`);
	}
	return midpoint(lo, hi);
}

function midpoint(a: string, b: string | null): string {
	if (b !== null) {
		let n = 0;
		while ((a[n] ?? '0') === b[n]) n++;
		if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
	}
	const da = a ? DIGITS.indexOf(a[0]) : 0;
	const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
	if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
	if (b !== null && b.length > 1) return b[0];
	return DIGITS[da] + midpoint(a.slice(1), null);
}
