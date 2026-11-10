import type { Task } from '#lib/app/app.svelte.ts';

const WEEK = 7 * 24 * 3_600_000;

export type Backlog = {
	/** Long-term threads first, then by nearest deadline, then oldest. */
	readonly active: readonly Task[];
	/** Newest first. */
	readonly done: readonly Task[];
	readonly archived: readonly Task[];
	/** Active tasks due from now through the next seven days, soonest first. */
	readonly soon: readonly Task[];
};

const due = (t: Task) => t.deadline ?? Infinity;

export function backlog(tasks: readonly Task[], now: number): Backlog {
	const of = (s: Task['status']) => tasks.filter((t) => t.status === s);
	const newest = (a: Task, b: Task) => b.createdAt - a.createdAt;
	const active = of('active');
	return {
		active: active.toSorted(
			(a, b) =>
				Number(b.longRunning) - Number(a.longRunning) ||
				due(a) - due(b) ||
				a.createdAt - b.createdAt
		),
		done: of('done').toSorted(newest),
		archived: of('archived').toSorted(newest),
		soon: active
			.filter((t) => t.deadline !== null && t.deadline >= now && t.deadline - now <= WEEK)
			.toSorted((a, b) => due(a) - due(b))
	};
}
