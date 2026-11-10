import { CHECKIN_FIELDS } from '../domain/checkin';
import type { DayKey } from '../domain/model';
import type { DayAggregate, DaySummary } from '../domain/stats';
import { addDays, daysFrom, weekday, weekOf } from '../domain/time';
import { spent } from '../ui/format';

const HOUR = 3_600_000;

/** Whether anything was watched that day: a tick, or focus or rest carried in. */
export function tracked(agg: DayAggregate): boolean {
	return agg.ticks > 0 || agg.focusMs > 0 || agg.restMs > 0;
}

export type MetricId = 'switches' | 'focus' | 'juggle' | 'strain' | 'headache';

export type Metric = {
	readonly label: string;
	/** Null when the day has nothing to say about it. */
	readonly value: (s: DaySummary) => number | null;
	/** The value that reads as lightest, and the floor of the value that reads as darkest. */
	readonly lo: number;
	readonly hi: (values: readonly number[]) => number;
	readonly format: (v: number) => string;
};

const most = (floor: number) => (values: readonly number[]) => Math.max(floor, ...values);

function answerLabel(key: 'strain' | 'headache', v: number): string {
	const f = CHECKIN_FIELDS[key];
	return f.labels[(f.values as readonly number[]).indexOf(v)] ?? String(v);
}

const answer = (key: 'strain' | 'headache') => (s: DaySummary) => s.checkIn[key] ?? null;

/** The year heatmap's metrics. Counts scale to the busiest day; answers to their scale. */
export const METRICS: Readonly<Record<MetricId, Metric>> = {
	switches: {
		label: 'switches',
		value: (s) => (tracked(s.agg) ? s.agg.switches : null),
		lo: 0,
		hi: most(12),
		format: (v) => `${v} ${v === 1 ? 'switch' : 'switches'}`
	},
	focus: {
		label: 'focus',
		value: (s) => (tracked(s.agg) ? s.agg.focusMs : null),
		lo: 0,
		hi: most(4 * HOUR),
		format: (v) => `${spent(v)} focus`
	},
	juggle: {
		label: 'juggle',
		value: (s) => (tracked(s.agg) ? s.agg.juggleMs : null),
		lo: 0,
		hi: most(HOUR),
		format: (v) => `${spent(v)} juggling`
	},
	strain: {
		label: 'strain',
		value: answer('strain'),
		lo: 1,
		hi: () => 5,
		format: (v) => `strain ${answerLabel('strain', v)}`
	},
	headache: {
		label: 'headache',
		value: answer('headache'),
		lo: 0,
		hi: () => 3,
		format: (v) => `headache ${answerLabel('headache', v)}`
	}
};

export const METRIC_IDS = Object.keys(METRICS) as MetricId[];

export const LEVELS = 4;

/** 0 for the lightest value, up to LEVELS for `hi` and above. Null stays null: no data. */
export function level(v: number | null, lo: number, hi: number): number | null {
	if (v === null) return null;
	if (v <= lo) return 0;
	return Math.min(LEVELS, Math.ceil(((v - lo) / Math.max(1e-9, hi - lo)) * LEVELS));
}

export type Cell = { readonly day: DayKey; readonly col: number; readonly row: number };

/** Days from `from` to `to` laid out in Monday-first week columns, one row per weekday. */
export function weekGrid(
	from: DayKey,
	to: DayKey
): { readonly cells: readonly Cell[]; readonly cols: number } {
	const origin = weekOf(from).from;
	const cells: Cell[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) {
		cells.push({ day: d, col: Math.floor(daysFrom(origin, d) / 7), row: weekday(d) });
	}
	return { cells, cols: (cells.at(-1)?.col ?? -1) + 1 };
}
