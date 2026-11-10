import type { CheckIn } from './checkin';
import { liveTotals, type DayView } from './focus';
import {
	REASONS,
	type DayKey,
	type Instant,
	type Reason,
	type Settings,
	type TaskId
} from './model';
import { hourIn, weekday } from './time';

/** Bump when aggregateDay changes meaning, so cached rows recompute. */
export const STATS_VERSION = 1;

/** What a cached aggregate was computed under. A row with another basis is stale. */
export function basisOf(s: Settings): string {
	return `${STATS_VERSION}|${s.timeZone}|${s.dayStartHour}`;
}

export type ReasonCounts = Readonly<Record<Reason | 'untagged', number>>;

export type TaskAggregate = {
	readonly task: TaskId;
	readonly ticks: number;
	readonly switchesIn: number;
	readonly ms: number;
};

/**
 * Everything multi-day views read about one day. A pure function of that day's marks,
 * the lookback before it, and Settings. Titles and check-ins join at read time, so
 * editing them never invalidates a cached row.
 */
export type DayAggregate = {
	readonly day: DayKey;
	readonly basis: string;
	readonly switches: number;
	readonly ticks: number;
	readonly focusMs: number;
	readonly juggleMs: number;
	readonly restMs: number;
	readonly reasons: ReasonCounts;
	/** Switches per local hour, index 0..23. */
	readonly switchesByHour: readonly number[];
	readonly tasks: readonly TaskAggregate[];
	readonly firstMark: Instant | null;
	readonly lastMark: Instant | null;
};

function noReasons(): Record<Reason | 'untagged', number> {
	return { done: 0, blocked: 0, urge: 0, pulled: 0, untagged: 0 };
}

/** For a live day pass `now`, and the open tail counts up to it. */
export function aggregateDay(view: DayView, s: Settings, now?: Instant): DayAggregate {
	const reasons = noReasons();
	const switchesByHour = new Array<number>(24).fill(0);
	for (const t of view.transitions) {
		if (t.kind !== 'switch') continue;
		reasons[t.reason ?? 'untagged']++;
		switchesByHour[hourIn(t.at, view.range, s)]++;
	}
	const totals =
		now === undefined ? { ...view.totals, perTask: view.perTask } : liveTotals(view, now);
	return {
		day: view.range.day,
		basis: basisOf(s),
		switches: view.switches,
		ticks: view.ticks,
		focusMs: totals.focusMs,
		juggleMs: totals.juggleMs,
		restMs: totals.restMs,
		reasons,
		switchesByHour,
		tasks: [...totals.perTask].map(([task, d]) => ({ task, ...d })),
		firstMark: view.transitions[0]?.at ?? null,
		lastMark: view.transitions.at(-1)?.at ?? null
	};
}

/** What a multi-day view gets per day: the aggregate and that day's check-in. */
export type DaySummary = { readonly agg: DayAggregate; readonly checkIn: CheckIn };

export type RangeTotals = {
	readonly days: number;
	readonly switches: number;
	readonly ticks: number;
	readonly focusMs: number;
	readonly juggleMs: number;
	readonly restMs: number;
	readonly reasons: ReasonCounts;
	/** Switches per hour of focus. Null with no focus time. */
	readonly switchesPerFocusHour: number | null;
};

export function rollup(aggs: readonly DayAggregate[]): RangeTotals {
	const reasons = noReasons();
	let switches = 0;
	let ticks = 0;
	let focusMs = 0;
	let juggleMs = 0;
	let restMs = 0;
	for (const a of aggs) {
		switches += a.switches;
		ticks += a.ticks;
		focusMs += a.focusMs;
		juggleMs += a.juggleMs;
		restMs += a.restMs;
		for (const r of [...REASONS, 'untagged'] as const) reasons[r] += a.reasons[r];
	}
	return {
		days: aggs.length,
		switches,
		ticks,
		focusMs,
		juggleMs,
		restMs,
		reasons,
		switchesPerFocusHour: focusMs > 0 ? switches / (focusMs / 3_600_000) : null
	};
}

export type SeriesPoint = {
	readonly day: DayKey;
	readonly switches: number;
	readonly focusMs: number;
	readonly juggleMs: number;
	readonly restMs: number;
	readonly strain: number | null;
	readonly stress: number | null;
};

export function series(days: readonly DaySummary[]): SeriesPoint[] {
	return days.map(({ agg, checkIn }) => ({
		day: agg.day,
		switches: agg.switches,
		focusMs: agg.focusMs,
		juggleMs: agg.juggleMs,
		restMs: agg.restMs,
		strain: checkIn.strain ?? null,
		stress: checkIn.stress ?? null
	}));
}

/** Mean switches per [weekday 0 = Monday][local hour], over the days given. */
export function weekdayHourHeat(aggs: readonly DayAggregate[]): number[][] {
	const sums = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
	const counts = new Array<number>(7).fill(0);
	for (const a of aggs) {
		const w = weekday(a.day);
		counts[w]++;
		for (let h = 0; h < 24; h++) sums[w][h] += a.switchesByHour[h];
	}
	return sums.map((row, w) => row.map((v) => (counts[w] ? v / counts[w] : 0)));
}

export type Fragmentation = {
	readonly task: TaskId;
	readonly switchesIn: number;
	readonly ms: number;
	/** Switches into the task per hour spent on it. */
	readonly switchesPerHour: number;
};

/** Tasks ranked by how often they were switched into per hour of work, most fragmented first. */
export function fragmentation(aggs: readonly DayAggregate[]): Fragmentation[] {
	const byTask = new Map<TaskId, { switchesIn: number; ms: number }>();
	for (const a of aggs) {
		for (const t of a.tasks) {
			const acc = byTask.get(t.task) ?? { switchesIn: 0, ms: 0 };
			acc.switchesIn += t.switchesIn;
			acc.ms += t.ms;
			byTask.set(t.task, acc);
		}
	}
	return [...byTask]
		.filter(([, v]) => v.ms > 0)
		.map(([task, v]) => ({ task, ...v, switchesPerHour: v.switchesIn / (v.ms / 3_600_000) }))
		.sort((a, b) => b.switchesPerHour - a.switchesPerHour || (a.task < b.task ? -1 : 1));
}

export type Insights = {
	readonly totals: RangeTotals;
	readonly series: readonly SeriesPoint[];
	readonly heat: readonly (readonly number[])[];
	readonly fragmentation: readonly Fragmentation[];
	/** Days with both a strain answer and tracked marks, for strain next to switches. */
	readonly strainVsSwitches: readonly {
		readonly day: DayKey;
		readonly strain: number;
		readonly switches: number;
	}[];
};

export function insights(days: readonly DaySummary[]): Insights {
	const aggs = days.map((d) => d.agg);
	return {
		totals: rollup(aggs),
		series: series(days),
		heat: weekdayHourHeat(aggs),
		fragmentation: fragmentation(aggs),
		strainVsSwitches: days.flatMap(({ agg, checkIn }) =>
			checkIn.strain !== undefined && agg.firstMark !== null
				? [{ day: agg.day, strain: checkIn.strain, switches: agg.switches }]
				: []
		)
	};
}
