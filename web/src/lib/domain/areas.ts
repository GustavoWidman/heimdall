import type { SwitchRecord } from './focus';
import type { Area, Task, TaskId } from './model';
import type { DayAggregate } from './stats';

/** Which area each task is in, as the tasks stand now. */
export type Areas = {
	/** Null for a task without an area, or one this device does not know. */
	readonly of: (task: TaskId) => Area | null;
	/**
	 * Every area in use: by active tasks in it, most first, then by name, so areas left
	 * only on done or archived tasks come last.
	 */
	readonly known: readonly Area[];
};

export function areasOf(tasks: Iterable<Task>): Areas {
	const byTask = new Map<TaskId, Area>();
	const active = new Map<Area, number>();
	for (const t of tasks) {
		if (t.area === null) continue;
		byTask.set(t.id, t.area);
		active.set(t.area, (active.get(t.area) ?? 0) + (t.status === 'active' ? 1 : 0));
	}
	const known = [...active.keys()].sort(
		(x, y) => active.get(y)! - active.get(x)! || (x < y ? -1 : 1)
	);
	return { of: (id) => byTask.get(id) ?? null, known };
}

export const SWITCH_CLASSES = ['hard', 'soft', 'unsorted'] as const;
export type SwitchClass = (typeof SWITCH_CLASSES)[number];

/** How a run of switches classifies. hard + soft + unsorted === total, always. */
export type SwitchSplit = { readonly [C in SwitchClass]: number } & { readonly total: number };

/**
 * Let E be the task entered and B the tasks held just before.
 *   E has no area                         -> unsorted
 *   E's area is among the areas held in B -> soft
 *   some task in B has no area            -> unsorted (it might share E's area)
 *   otherwise                             -> hard
 * A match in B is soft even when B also holds a task without an area.
 */
export function classify(s: SwitchRecord, areas: Areas): SwitchClass {
	const entered = areas.of(s.into);
	if (entered === null) return 'unsorted';
	let blind = false;
	for (const t of s.from) {
		const a = areas.of(t);
		if (a === entered) return 'soft';
		if (a === null) blind = true;
	}
	return blind ? 'unsorted' : 'hard';
}

type Counts = { -readonly [C in SwitchClass]: number } & { total: number };

const noSwitches = (): Counts => ({ hard: 0, soft: 0, unsorted: 0, total: 0 });

export function splitSwitches(log: Iterable<SwitchRecord>, areas: Areas): SwitchSplit {
	const out = noSwitches();
	for (const s of log) {
		out[classify(s, areas)]++;
		out.total++;
	}
	return out;
}

/** The hard count to show, or null when no switch could be sorted. */
export function hardOf(split: SwitchSplit): number | null {
	return split.hard + split.soft > 0 ? split.hard : null;
}

export type AreaRow = {
	/** Null is the row of tasks without an area. */
	readonly area: Area | null;
	/** Switches into this area's tasks, and how they classify. Rows' totals add up to all switches. */
	readonly switches: SwitchSplit;
	/** Even-split shares, so rows add up to focusMs and juggleMs. */
	readonly focusMs: number;
	readonly juggleMs: number;
};

export type AreaBreakdown = {
	/** Areas with any switch or time in the days, most focus first; the no-area row last. */
	readonly rows: readonly AreaRow[];
	/** Every switch in the days. */
	readonly switches: SwitchSplit;
};

export function areaBreakdown(
	days: readonly Pick<DayAggregate, 'switchLog' | 'tasks'>[],
	areas: Areas
): AreaBreakdown {
	const rows = new Map<Area | null, { switches: Counts; focusMs: number; juggleMs: number }>();
	const row = (a: Area | null) => {
		let r = rows.get(a);
		if (!r) rows.set(a, (r = { switches: noSwitches(), focusMs: 0, juggleMs: 0 }));
		return r;
	};
	const all = noSwitches();
	for (const day of days) {
		for (const s of day.switchLog) {
			const c = classify(s, areas);
			const r = row(areas.of(s.into));
			r.switches[c]++;
			r.switches.total++;
			all[c]++;
			all.total++;
		}
		for (const t of day.tasks) {
			const r = row(areas.of(t.task));
			r.focusMs += t.shareMs;
			r.juggleMs += t.juggleShareMs;
		}
	}
	return {
		rows: [...rows]
			.filter(([, r]) => r.switches.total > 0 || r.focusMs > 0)
			.map(([area, r]) => ({ area, ...r }))
			.sort(
				(x, y) =>
					Number(x.area === null) - Number(y.area === null) ||
					y.focusMs - x.focusMs ||
					((x.area ?? '') < (y.area ?? '') ? -1 : 1)
			),
		switches: all
	};
}
