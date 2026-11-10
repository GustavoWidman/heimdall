import type { Mark, Task, TaskId } from '#lib/app/app.svelte.ts';

/** How a mark reads in a list: what was done, and to which task. */
export function describe(
	mark: Mark,
	task: (id: TaskId) => Task | undefined
): { readonly verb: string; readonly task: Task | null } {
	const g = mark.gesture;
	switch (g.k) {
		case 'tap':
			return { verb: 'switched to', task: task(g.task) ?? null };
		case 'hold':
			return { verb: 'juggled in', task: task(g.task) ?? null };
		case 'release':
			return { verb: 'let go of', task: task(g.task) ?? null };
		case 'rest':
			return { verb: 'rested', task: null };
		case 'off':
			return { verb: 'stopped watching', task: null };
	}
}
