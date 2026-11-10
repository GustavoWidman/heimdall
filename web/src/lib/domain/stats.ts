import type { CheckIn } from './checkin';
import {
	CARRY_LOOKBACK_MS,
	carryIn,
	deriveDay,
	liveTotals,
	type DayView,
	type Segment,
	type TransitionKind
} from './focus';
import {
	REASONS,
	type DayKey,
	type Instant,
	type Mark,
	type Reason,
	type Settings,
	type Task,
	type TaskId
} from './model';
import { hourIn, rangeOf, weekday } from './time';

const HOUR = 3_600_000;

/** Bump when aggregateDay changes meaning, so cached rows recompute. */
export const STATS_VERSION = 2;

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
	/** Times the task dropped out of focus on a switch tagged urge. */
	readonly leftByUrge: number;
	/** Time on the task per hour since the day began: index 0 is the day's first hour. */
	readonly msByElapsedHour: readonly number[];
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
	/**
	 * Lengths of the day's focus stretches, in order. A stretch starts when a task enters
	 * focus (or is carried in at day start) and ends at the next switch, rest, or off.
	 * Narrowing a juggle continues it.
	 */
	readonly stretches: readonly number[];
	readonly firstMark: Instant | null;
	readonly lastMark: Instant | null;
};

function noReasons(): Record<Reason | 'untagged', number> {
	return { done: 0, blocked: 0, urge: 0, pulled: 0, untagged: 0 };
}

/** The closed segments, plus the open tail up to `now` on a live day, clipped to the day. */
function timeline(view: DayView, now?: Instant): Segment[] {
	const segs = [...view.segments];
	if (view.tail && now !== undefined) {
		const end = Math.min(now, view.range.end) as Instant;
		if (end > view.tail.start) segs.push({ ...view.tail, end });
	}
	return segs;
}

function stretchesOf(segs: readonly Segment[], kindOf: ReadonlyMap<string, TransitionKind>) {
	const out: number[] = [];
	let open: number | null = null;
	for (const s of segs) {
		const ms = s.end - s.start;
		if (open !== null && s.focus.k === 'working' && s.mark && kindOf.get(s.mark) === 'narrow') {
			open += ms;
			continue;
		}
		if (open !== null) out.push(open);
		open = s.focus.k === 'working' ? ms : null;
	}
	if (open !== null) out.push(open);
	return out;
}

function hourlyByTask(segs: readonly Segment[], view: DayView): Map<TaskId, number[]> {
	const { start, end } = view.range;
	const hours = Math.ceil((end - start) / HOUR);
	const out = new Map<TaskId, number[]>();
	for (const s of segs) {
		if (s.focus.k !== 'working') continue;
		for (let h = Math.floor((s.start - start) / HOUR); h < hours; h++) {
			const lo = Math.max(s.start, start + h * HOUR);
			const hi = Math.min(s.end, start + (h + 1) * HOUR);
			if (hi <= lo) break;
			for (const t of s.focus.tasks) {
				let row = out.get(t);
				if (!row) out.set(t, (row = new Array<number>(hours).fill(0)));
				row[h] += hi - lo;
			}
		}
	}
	return out;
}

function urgeLeaves(view: DayView): Map<TaskId, number> {
	const out = new Map<TaskId, number>();
	const c = view.carry;
	let held: readonly TaskId[] = c.focus.k === 'working' ? c.focus.tasks : (c.held ?? []);
	for (const t of view.transitions) {
		if (t.kind === 'switch' && t.reason === 'urge') {
			const from = t.from.k === 'working' ? t.from.tasks : held;
			const to: readonly TaskId[] = t.to.k === 'working' ? t.to.tasks : [];
			for (const task of from) if (!to.includes(task)) out.set(task, (out.get(task) ?? 0) + 1);
		}
		if (t.to.k === 'working') held = t.to.tasks;
		else if (t.to.k === 'off') held = [];
	}
	return out;
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
	const segs = timeline(view, now);
	const hourly = hourlyByTask(segs, view);
	const urge = urgeLeaves(view);
	const hours = Math.ceil((view.range.end - view.range.start) / HOUR);
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
		tasks: [...totals.perTask].map(([task, d]) => ({
			task,
			...d,
			leftByUrge: urge.get(task) ?? 0,
			msByElapsedHour: hourly.get(task) ?? new Array<number>(hours).fill(0)
		})),
		stretches: stretchesOf(segs, new Map(view.transitions.map((t) => [t.mark, t.kind]))),
		firstMark: view.transitions[0]?.at ?? null,
		lastMark: view.transitions.at(-1)?.at ?? null
	};
}

function firstAtOrAfter(sorted: readonly Mark[], at: number): number {
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid].at < at) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * Aggregate closed days, one at a time so a caller can yield between them. `sorted` holds
 * marks in timeline order covering every day asked for and the lookback before it.
 */
export function* aggregateDays(
	sorted: readonly Mark[],
	days: readonly DayKey[],
	s: Settings
): Generator<DayAggregate> {
	for (const day of days) {
		const range = rangeOf(day, s);
		const window = sorted.slice(
			firstAtOrAfter(sorted, range.start - CARRY_LOOKBACK_MS),
			firstAtOrAfter(sorted, range.end)
		);
		yield aggregateDay(deriveDay(window, range, carryIn(window, range.start), false), s);
	}
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
		switchesPerFocusHour: focusMs > 0 ? switches / (focusMs / HOUR) : null
	};
}

export type SeriesPoint = {
	readonly day: DayKey;
	/** The day has at least one mark. */
	readonly tracked: boolean;
	readonly switches: number;
	readonly focusMs: number;
	readonly juggleMs: number;
	readonly restMs: number;
	readonly reasons: ReasonCounts;
	readonly stretchMedianMs: number | null;
	readonly stretchLongestMs: number | null;
	readonly strain: number | null;
	readonly stress: number | null;
	readonly headache: number | null;
};

function quantile(sorted: readonly number[], q: number): number {
	const i = (sorted.length - 1) * q;
	const lo = Math.floor(i);
	return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}

export function median(values: readonly number[]): number | null {
	return values.length
		? quantile(
				[...values].sort((a, b) => a - b),
				0.5
			)
		: null;
}

export function series(days: readonly DaySummary[]): SeriesPoint[] {
	return days.map(({ agg, checkIn }) => ({
		day: agg.day,
		tracked: agg.firstMark !== null,
		switches: agg.switches,
		focusMs: agg.focusMs,
		juggleMs: agg.juggleMs,
		restMs: agg.restMs,
		reasons: agg.reasons,
		stretchMedianMs: median(agg.stretches),
		stretchLongestMs: agg.stretches.length ? Math.max(...agg.stretches) : null,
		strain: checkIn.strain ?? null,
		stress: checkIn.stress ?? null,
		headache: checkIn.headache ?? null
	}));
}

/** A person's own usual level: the median and the middle half of their days. */
export type Baseline = {
	readonly median: number;
	/** 25th percentile. */
	readonly lo: number;
	/** 75th percentile. */
	readonly hi: number;
	readonly days: number;
};

/** Fewer days than this say too little about what is usual. */
export const BASELINE_MIN_DAYS = 5;

export function baseline(values: readonly number[]): Baseline | null {
	if (values.length < BASELINE_MIN_DAYS) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return {
		median: quantile(sorted, 0.5),
		lo: quantile(sorted, 0.25),
		hi: quantile(sorted, 0.75),
		days: sorted.length
	};
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

export type TaskTotals = {
	readonly task: TaskId;
	readonly ticks: number;
	readonly switchesIn: number;
	readonly ms: number;
	readonly leftByUrge: number;
	/** Switches into the task per hour spent on it. Null with no time on it. */
	readonly switchesPerHour: number | null;
};

/** Every task touched in the days given, most time first. */
export function taskTotals(aggs: readonly DayAggregate[]): TaskTotals[] {
	const byTask = new Map<TaskId, { ticks: number; switchesIn: number; ms: number; urge: number }>();
	for (const a of aggs) {
		for (const t of a.tasks) {
			const acc = byTask.get(t.task) ?? { ticks: 0, switchesIn: 0, ms: 0, urge: 0 };
			acc.ticks += t.ticks;
			acc.switchesIn += t.switchesIn;
			acc.ms += t.ms;
			acc.urge += t.leftByUrge;
			byTask.set(t.task, acc);
		}
	}
	return [...byTask]
		.map(([task, v]) => ({
			task,
			ticks: v.ticks,
			switchesIn: v.switchesIn,
			ms: v.ms,
			leftByUrge: v.urge,
			switchesPerHour: v.ms > 0 ? v.switchesIn / (v.ms / HOUR) : null
		}))
		.sort((a, b) => b.ms - a.ms || (a.task < b.task ? -1 : 1));
}

export type DeadlinePressure = {
	readonly task: TaskId;
	readonly deadline: Instant;
	/** Time on the task inside the days given and before the deadline. */
	readonly ms: number;
	readonly msLast24h: number;
	readonly msLast3h: number;
};

/** Time in `row`, hourly buckets from `start`, that falls in [lo, hi). */
function timeWithin(row: readonly number[], start: number, lo: number, hi: number): number {
	let ms = 0;
	for (let h = 0; h < row.length; h++) {
		if (row[h] === 0) continue;
		const overlap = Math.min(hi, start + (h + 1) * HOUR) - Math.max(lo, start + h * HOUR);
		if (overlap > 0) ms += (row[h] * overlap) / HOUR;
	}
	return ms;
}

/**
 * Tasks whose deadline fell inside the days given, latest first, and how much of their time
 * came close to it. Time is kept per hour, so an hour that straddles a cutoff counts in
 * proportion.
 */
export function deadlinePressure(
	aggs: readonly DayAggregate[],
	tasks: readonly Task[],
	s: Settings,
	now: Instant
): DeadlinePressure[] {
	if (aggs.length === 0) return [];
	const from = rangeOf(aggs[0].day, s).start;
	const to = Math.min(now, rangeOf(aggs[aggs.length - 1].day, s).end);
	const out: DeadlinePressure[] = [];
	for (const t of tasks) {
		const d = t.deadline;
		if (d === null || d < from || d > to) continue;
		let ms = 0;
		let msLast24h = 0;
		let msLast3h = 0;
		for (const a of aggs) {
			const row = a.tasks.find((x) => x.task === t.id)?.msByElapsedHour;
			if (!row) continue;
			const start = rangeOf(a.day, s).start;
			ms += timeWithin(row, start, from, d);
			msLast24h += timeWithin(row, start, d - 24 * HOUR, d);
			msLast3h += timeWithin(row, start, d - 3 * HOUR, d);
		}
		out.push({ task: t.id, deadline: d, ms, msLast24h, msLast3h });
	}
	return out.sort((a, b) => b.deadline - a.deadline);
}

const WEEKDAYS = [
	'mondays',
	'tuesdays',
	'wednesdays',
	'thursdays',
	'fridays',
	'saturdays',
	'sundays'
] as const;

/** Days on each side before two groups of days are compared at all. */
export const STANDOUT_MIN_DAYS = 3;

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A gap worth stating: at least 3 switches and 15% of the smaller side. */
function notable(a: number, b: number): boolean {
	const gap = Math.abs(Math.round(a) - Math.round(b));
	return gap >= 3 && gap >= 0.15 * Math.min(a, b);
}

/** Mean switches of two groups of days, when both are big enough and differ enough. */
function contrast(
	a: readonly SeriesPoint[],
	b: readonly SeriesPoint[]
): { a: number; b: number; gap: number; more: 'more' | 'fewer' } | null {
	if (a.length < STANDOUT_MIN_DAYS || b.length < STANDOUT_MIN_DAYS) return null;
	const ma = mean(a.map((p) => p.switches));
	const mb = mean(b.map((p) => p.switches));
	if (!notable(ma, mb)) return null;
	const [ra, rb] = [Math.round(ma), Math.round(mb)];
	return { a: ra, b: rb, gap: Math.abs(ra - rb), more: ma > mb ? 'more' : 'fewer' };
}

/**
 * Plain observations about closed, tracked days, each worded as description. A comparison
 * needs enough days on both sides and a gap worth stating; otherwise it says nothing.
 */
export function standouts(
	days: readonly SeriesPoint[],
	aggs: readonly DayAggregate[],
	tasks: readonly TaskTotals[],
	titleOf: (task: TaskId) => string
): string[] {
	const out: string[] = [];

	if (days.length >= 14) {
		const c = contrast(days.slice(-7), days.slice(0, -7));
		if (c) {
			out.push(
				`the last 7 days averaged ${c.a} switches a day, ${c.gap} ${c.more} than the ${days.length - 7} days before`
			);
		}
	}

	const byWeekday = WEEKDAYS.map((_, w) => days.filter((p) => weekday(p.day) === w));
	const enough = (g: readonly SeriesPoint[]) => g.length >= STANDOUT_MIN_DAYS;
	if (byWeekday.filter(enough).length >= 4) {
		const means = byWeekday.map((g) => (enough(g) ? mean(g.map((p) => p.switches)) : -1));
		const top = means.indexOf(Math.max(...means));
		const c = contrast(
			byWeekday[top],
			days.filter((p) => weekday(p.day) !== top)
		);
		if (c?.more === 'more') {
			out.push(
				`${WEEKDAYS[top]} had the most switches, ${c.a} on average against ${c.b} on other days`
			);
		}
	}

	const answered = days.filter((p) => p.headache !== null);
	const headache = contrast(
		answered.filter((p) => (p.headache ?? 0) > 0),
		answered.filter((p) => p.headache === 0)
	);
	if (headache) {
		out.push(
			`headache days averaged ${headache.gap} ${headache.more} switches than days without, ${headache.a} against ${headache.b}`
		);
	}

	const strain = contrast(
		days.filter((p) => p.strain !== null && p.strain >= 4),
		days.filter((p) => p.strain !== null && p.strain <= 2)
	);
	if (strain) {
		out.push(
			`days you rated strain 4 or 5 averaged ${strain.a} switches, against ${strain.b} on days rated 1 or 2`
		);
	}

	const byHour = new Array<number>(24).fill(0);
	for (const a of aggs) a.switchesByHour.forEach((n, h) => (byHour[h] += n));
	const total = byHour.reduce((a, b) => a + b, 0);
	const peak = byHour.indexOf(Math.max(...byHour));
	if (total >= 40 && byHour[peak] >= 1.5 * mean(byHour.filter((n) => n > 0))) {
		out.push(
			`switching peaks in the ${String(peak).padStart(2, '0')}:00 hour, with ${Math.round((100 * byHour[peak]) / total)}% of all switches`
		);
	}

	const reasons = rollup(aggs).reasons;
	const tagged = REASONS.reduce((n, r) => n + reasons[r], 0);
	if (tagged >= 20) {
		const top = REASONS.reduce((a, b) => (reasons[b] > reasons[a] ? b : a));
		const share = reasons[top] / tagged;
		if (share >= 0.4) {
			out.push(
				`${top} is the reason you give most, ${Math.round(100 * share)}% of tagged switches`
			);
		}
	}

	const [first, second] = [...tasks].sort((a, b) => b.leftByUrge - a.leftByUrge);
	if (first && first.leftByUrge >= 5 && first.leftByUrge >= 1.5 * (second?.leftByUrge ?? 0)) {
		out.push(
			`${titleOf(first.task)} is the task you most often leave on an urge, ${first.leftByUrge} times`
		);
	}

	const worked = tasks.filter((t) => t.ms >= HOUR && t.switchesPerHour !== null);
	if (worked.length >= 3) {
		const rates = worked.map((t) => t.switchesPerHour as number);
		const rate = Math.max(...rates);
		const top = worked[rates.indexOf(rate)];
		if (rate >= 1 && rate >= 2 * (median(rates) as number)) {
			out.push(
				`${titleOf(top.task)} is switched into most often for its time, ${rate.toFixed(1)} times per hour on it`
			);
		}
	}

	return out;
}

export type InsightsContext = {
	readonly settings: Settings;
	readonly tasks: readonly Task[];
	/** Still under way, so it is shown but kept out of baselines and comparisons. */
	readonly today: DayKey;
	readonly now: Instant;
};

export type Insights = {
	readonly totals: RangeTotals;
	readonly series: readonly SeriesPoint[];
	/** Over tracked days only, so days without marks do not dilute the averages. */
	readonly heat: readonly (readonly number[])[];
	readonly tasks: readonly TaskTotals[];
	/** Switches per day over closed tracked days. Null with too few of them. */
	readonly baseline: Baseline | null;
	readonly deadlines: readonly DeadlinePressure[];
	readonly standouts: readonly string[];
};

export function insights(days: readonly DaySummary[], ctx: InsightsContext): Insights {
	const aggs = days.map((d) => d.agg);
	const tracked = aggs.filter((a) => a.firstMark !== null);
	const points = series(days);
	const closed = points.filter((p) => p.tracked && p.day !== ctx.today);
	const tasks = taskTotals(aggs);
	const titles = new Map<TaskId, string>(ctx.tasks.map((t) => [t.id, t.title]));
	return {
		totals: rollup(aggs),
		series: points,
		heat: weekdayHourHeat(tracked),
		tasks,
		baseline: baseline(closed.map((p) => p.switches)),
		deadlines: deadlinePressure(aggs, ctx.tasks, ctx.settings, ctx.now),
		standouts: standouts(
			closed,
			tracked.filter((a) => a.day !== ctx.today),
			tasks,
			(t) => titles.get(t) ?? 'a task'
		)
	};
}
