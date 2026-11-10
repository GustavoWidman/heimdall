import { describe, expect, it } from 'vitest';
import { carryIn, deriveDay } from './focus';
import type { DayKey, Hue, Instant, MarkId, Task, TaskId, Title } from './model';
import {
	aggregateDay,
	aggregateDays,
	basisOf,
	baseline,
	deadlinePressure,
	insights,
	rollup,
	series,
	standouts,
	taskTotals,
	type SeriesPoint
} from './stats';
import { byTime } from './focus';
import { addDays, rangeOf } from './time';
import * as notebook from './notebook-day.fixture';

const MIN = 60_000;
const range = rangeOf(notebook.day, notebook.settings);
const view = deriveDay(notebook.marks, range, carryIn(notebook.marks, range.start), false);
const agg = aggregateDay(view, notebook.settings);

describe('aggregateDay on the notebook day', () => {
	it('carries the hand-counted totals', () => {
		expect(agg).toMatchObject({
			day: notebook.day,
			basis: basisOf(notebook.settings),
			switches: notebook.expected.switches,
			ticks: notebook.expected.ticks,
			focusMs: notebook.expected.focusMs,
			juggleMs: notebook.expected.juggleMs,
			restMs: notebook.expected.restMs,
			reasons: notebook.expected.reasons,
			firstMark: notebook.local(notebook.day, '08:00'),
			lastMark: notebook.local(notebook.day, '22:00')
		});
	});

	it('buckets switches by local hour', () => {
		const expected = Array.from({ length: 24 }, (_, h) => notebook.expected.switchesByHour[h] ?? 0);
		expect(agg.switchesByHour).toEqual(expected);
	});

	it('lists each task with its ticks, switches in, and time', () => {
		expect(
			new Map(agg.tasks.map(({ task, ticks, switchesIn, ms }) => [task, { ticks, switchesIn, ms }]))
		).toEqual(notebook.expected.perTask);
	});

	it('measures each focus stretch, ending at a switch, rest, or off and running through a narrow', () => {
		expect(agg.stretches.map((ms) => ms / MIN)).toEqual([
			20, 30, 50, 40, 15, 5, 70, 15, 45, 80, 30, 5, 35, 60, 60
		]);
	});

	it('counts the tasks left behind on a switch tagged urge', () => {
		const urge = new Map(agg.tasks.map((t) => [t.task, t.leftByUrge]));
		expect(urge).toEqual(
			new Map([
				[notebook.mail, 0],
				[notebook.report, 2],
				[notebook.slack, 0],
				[notebook.code, 0]
			])
		);
	});

	it('spreads each task’s time over the hours since the day began at 04:00', () => {
		const report = agg.tasks.find((t) => t.task === notebook.report)!.msByElapsedHour;
		expect(report).toHaveLength(24);
		const nonzero = Object.fromEntries(report.flatMap((ms, h) => (ms ? [[h + 4, ms / MIN]] : [])));
		expect(nonzero).toEqual({ 8: 40, 9: 50, 10: 30, 14: 60, 15: 50, 16: 35 });
	});

	it('names the settings it was computed under, so a zone change makes it stale', () => {
		expect(basisOf({ ...notebook.settings, dayStartHour: 5 as never })).not.toBe(agg.basis);
	});
});

describe('a live day', () => {
	it('counts the open stretch up to now', () => {
		const marks = [
			{
				id: 'm_1' as MarkId,
				at: notebook.local(notebook.day, '09:00'),
				gesture: { k: 'tap', task: notebook.mail },
				voided: false,
				reason: null
			}
		] as const;
		const live = deriveDay(marks, range, carryIn(marks, range.start), true);
		const a = aggregateDay(live, notebook.settings, notebook.local(notebook.day, '09:45'));
		expect(a.focusMs).toBe(45 * MIN);
		expect(a.tasks).toMatchObject([{ task: notebook.mail, ticks: 1, switchesIn: 0, ms: 45 * MIN }]);
		expect(a.tasks[0].msByElapsedHour[5]).toBe(45 * MIN);
		expect(a.stretches).toEqual([45 * MIN]);
	});
});

describe('multi-day reads', () => {
	const monday = { ...agg, day: '2026-11-09' as DayKey };
	const tuesday = {
		...agg,
		day: '2026-11-10' as DayKey,
		switches: 3,
		switchesByHour: agg.switchesByHour.map((_, h) => (h === 9 ? 3 : 0))
	};
	const untracked = { ...tuesday, day: '2026-11-17' as DayKey, firstMark: null };
	const ctx = {
		settings: notebook.settings,
		tasks: [],
		today: '2026-11-30' as DayKey,
		now: notebook.local('2026-11-30', '12:00')
	};

	it('rolls up totals and the switch rate per focus hour', () => {
		const r = rollup([monday, tuesday]);
		expect(r.days).toBe(2);
		expect(r.switches).toBe(14);
		expect(r.focusMs).toBe(2 * 560 * MIN);
		expect(r.reasons.urge).toBe(4);
		expect(r.switchesPerFocusHour).toBeCloseTo(14 / ((2 * 560) / 60));
	});

	it('averages switches per weekday and hour over tracked days, and joins check-ins', () => {
		const i = insights(
			[
				{ agg: monday, checkIn: { strain: 4, headache: 2 } },
				{ agg: tuesday, checkIn: { strain: 2 } },
				{ agg: untracked, checkIn: {} }
			],
			ctx
		);
		expect(i.heat[0][10]).toBe(3);
		expect(i.heat[1][9]).toBe(3);
		expect(i.series.map((p) => [p.strain, p.headache, p.tracked])).toEqual([
			[4, 2, true],
			[2, null, true],
			[null, null, false]
		]);
	});

	it('gives each day its median and longest focus stretch', () => {
		const [p] = series([{ agg: monday, checkIn: {} }]);
		expect(p.stretchMedianMs).toBe(35 * MIN);
		expect(p.stretchLongestMs).toBe(80 * MIN);
	});

	it('totals each task, most time first, with its switches in per hour on it', () => {
		const t = taskTotals([monday, tuesday]);
		expect(t.map((x) => x.task)).toEqual([
			notebook.code,
			notebook.report,
			notebook.mail,
			notebook.slack
		]);
		expect(t[1]).toMatchObject({ ms: 2 * 265 * MIN, switchesIn: 6, leftByUrge: 4 });
		expect(t[3].switchesPerHour).toBeCloseTo(3 / (25 / 60));
	});

	it('leaves today and untracked days out of the baseline', () => {
		const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map(
			(d, k) => ({ agg: { ...monday, day: d as DayKey, switches: 10 * (k + 1) }, checkIn: {} })
		);
		const withToday = [
			...days,
			{ agg: { ...monday, day: ctx.today, switches: 500 }, checkIn: {} },
			{ agg: untracked, checkIn: {} }
		];
		expect(insights(withToday, ctx).baseline).toEqual({ median: 30, lo: 20, hi: 40, days: 5 });
		expect(insights(withToday.slice(1), ctx).baseline).toBeNull();
	});
});

describe('baseline', () => {
	it('is the median and middle half of the values given', () => {
		expect(baseline([50, 10, 40, 20, 30])).toEqual({ median: 30, lo: 20, hi: 40, days: 5 });
		expect(baseline([1, 2, 3, 4, 5, 6])).toEqual({ median: 3.5, lo: 2.25, hi: 4.75, days: 6 });
	});

	it('says nothing with fewer than five days', () => {
		expect(baseline([10, 20, 30, 40])).toBeNull();
	});
});

describe('deadlinePressure', () => {
	const task = (id: TaskId, deadline: Instant | null): Task => ({
		id,
		title: id as string as Title,
		note: null,
		hue: 0 as Hue,
		deadline,
		longRunning: false,
		status: 'active',
		createdAt: 0 as Instant
	});
	const now = notebook.local(notebook.day, '23:00');

	it('splits a task’s time before its deadline into the last 24 hours and the last 3', () => {
		const [p] = deadlinePressure(
			[agg],
			[task(notebook.report, notebook.local(notebook.day, '16:00'))],
			notebook.settings,
			now
		);
		// report ran 08:20-09:40, 09:50-10:30, 14:00-15:20, and 15:30-16:00 before 16:00.
		expect(p.ms / MIN).toBe(230);
		expect(p.msLast24h / MIN).toBe(230);
		expect(p.msLast3h / MIN).toBe(110);
	});

	it('counts only the time before the deadline, and the 24 hours reach into the day before', () => {
		const next = addDays(notebook.day, 1);
		const quiet = aggregateDay(
			deriveDay([], rangeOf(next, notebook.settings), carryIn([], 0 as Instant), false),
			notebook.settings
		);
		const [p] = deadlinePressure(
			[agg, quiet],
			[task(notebook.code, notebook.local(next, '11:00'))],
			notebook.settings,
			notebook.local(next, '23:00')
		);
		// code after 11:00 the day before: 11:00-12:00, 13:15-15:00, 19:00-21:00.
		expect(p.ms / MIN).toBe(315);
		expect(p.msLast24h / MIN).toBe(60 + 105 + 120);
		expect(p.msLast3h).toBe(0);
	});

	it('lists only deadlines inside the window and already past, latest first', () => {
		const out = deadlinePressure(
			[agg],
			[
				task(notebook.mail, notebook.local(notebook.day, '09:00')),
				task(notebook.code, notebook.local(notebook.day, '20:00')),
				task(notebook.slack, null),
				task(notebook.report, notebook.local(addDays(notebook.day, 2), '09:00')),
				task('t_old' as TaskId, notebook.local(addDays(notebook.day, -1), '09:00'))
			],
			notebook.settings,
			now
		);
		expect(out.map((p) => p.task)).toEqual([notebook.code, notebook.mail]);
	});
});

describe('standouts', () => {
	const point = (day: string, switches: number, extra: Partial<SeriesPoint> = {}): SeriesPoint => ({
		day: day as DayKey,
		tracked: true,
		switches,
		focusMs: 0,
		juggleMs: 0,
		restMs: 0,
		reasons: { done: 0, blocked: 0, urge: 0, pulled: 0, untagged: switches },
		stretchMedianMs: null,
		stretchLongestMs: null,
		strain: null,
		stress: null,
		headache: null,
		...extra
	});
	const title = (t: TaskId) => `task ${t}`;
	const days = (n: number, from = '2026-11-02') =>
		Array.from({ length: n }, (_, k) => addDays(from as DayKey, k));

	it('compares headache days with days without once both have three days', () => {
		const [a, b, c, d, e, f] = days(6);
		const s = standouts(
			[
				point(a, 30, { headache: 1 }),
				point(b, 28, { headache: 2 }),
				point(c, 32, { headache: 1 }),
				point(d, 20, { headache: 0 }),
				point(e, 19, { headache: 0 }),
				point(f, 21, { headache: 0 })
			],
			[],
			[],
			title
		);
		expect(s).toEqual(['headache days averaged 10 more switches than days without, 30 against 20']);
	});

	it('stays silent with two days on one side, or a gap too small to state', () => {
		const [a, b, c, d, e, f] = days(6);
		const few = [
			point(a, 30, { headache: 1 }),
			point(b, 30, { headache: 1 }),
			point(c, 20, { headache: 0 }),
			point(d, 20, { headache: 0 }),
			point(e, 20, { headache: 0 })
		];
		expect(standouts(few, [], [], title)).toEqual([]);
		const close = [
			point(a, 21, { strain: 5 }),
			point(b, 21, { strain: 4 }),
			point(c, 22, { strain: 4 }),
			point(d, 20, { strain: 1 }),
			point(e, 20, { strain: 2 }),
			point(f, 20, { strain: 2 })
		];
		expect(standouts(close, [], [], title)).toEqual([]);
	});

	it('names the busiest weekday once four weekdays have three days each', () => {
		const three = days(21, '2026-11-02').map((d, k) => point(d, k % 7 === 1 ? 40 : 20));
		expect(standouts(three, [], [], title)).toContain(
			'tuesdays had the most switches, 40 on average against 20 on other days'
		);
		expect(standouts(three.slice(0, 14), [], [], title)).toEqual([]);
	});

	it('names the task most often left on an urge, only when it clearly leads', () => {
		const t = (task: string, leftByUrge: number) => ({
			task: task as TaskId,
			ticks: 0,
			switchesIn: 0,
			ms: 0,
			leftByUrge,
			switchesPerHour: null
		});
		expect(standouts([], [], [t('inbox', 9), t('report', 4)], title)).toEqual([
			'task inbox is the task you most often leave on an urge, 9 times'
		]);
		expect(standouts([], [], [t('inbox', 9), t('report', 7)], title)).toEqual([]);
		expect(standouts([], [], [t('inbox', 4)], title)).toEqual([]);
	});

	it('says nothing at all on day one', () => {
		expect(standouts([], [], [], title)).toEqual([]);
	});
});

describe('aggregateDays', () => {
	it('gives each day the aggregate it has alone, carry included', () => {
		const next = addDays(notebook.day, 1);
		const late = {
			id: 'm_late' as MarkId,
			at: notebook.local(notebook.day, '23:30'),
			gesture: { k: 'tap', task: notebook.code },
			voided: false,
			reason: null
		} as const;
		const marks = [...notebook.marks, late].sort(byTime);
		const [first, second] = [...aggregateDays(marks, [notebook.day, next], notebook.settings)];
		expect(first.switches).toBe(notebook.expected.switches);
		expect(first.focusMs).toBe(notebook.expected.focusMs + 270 * MIN);
		expect(second).toMatchObject({
			day: next,
			switches: 0,
			focusMs: 24 * 60 * MIN,
			firstMark: null
		});
	});
});
