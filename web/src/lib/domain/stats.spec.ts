import { describe, expect, it } from 'vitest';
import { carryIn, deriveDay } from './focus';
import type { DayKey, MarkId } from './model';
import { aggregateDay, aggregateDays, basisOf, insights, rollup } from './stats';
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
		expect(new Map(agg.tasks.map(({ task, ...rest }) => [task, rest]))).toEqual(
			notebook.expected.perTask
		);
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
		expect(a.tasks).toEqual([{ task: notebook.mail, ticks: 1, switchesIn: 0, ms: 45 * MIN }]);
	});
});

describe('multi-day reads', () => {
	const monday = { ...agg, day: '2026-11-09' as DayKey };
	const tuesday = {
		...agg,
		day: '2026-11-10' as DayKey,
		switches: 3,
		switchesByHour: agg.switchesByHour.map((_, h) => (h === 9 ? 3 : 0)),
		firstMark: null
	};
	const nextMonday = { ...agg, day: '2026-11-16' as DayKey, switches: 5 };

	it('rolls up totals and the switch rate per focus hour', () => {
		const r = rollup([monday, tuesday]);
		expect(r.days).toBe(2);
		expect(r.switches).toBe(14);
		expect(r.focusMs).toBe(2 * 560 * MIN);
		expect(r.reasons.urge).toBe(4);
		expect(r.switchesPerFocusHour).toBeCloseTo(14 / ((2 * 560) / 60));
	});

	it('averages switches per weekday and hour, and joins strain from check-ins', () => {
		const i = insights([
			{ agg: monday, checkIn: { strain: 4 } },
			{ agg: tuesday, checkIn: { strain: 2 } },
			{ agg: nextMonday, checkIn: {} }
		]);
		expect(i.heat[0][10]).toBe(3);
		expect(i.heat[1][9]).toBe(3);
		expect(i.heat[1][10]).toBe(0);
		expect(i.series.map((p) => p.strain)).toEqual([4, 2, null]);
		expect(i.strainVsSwitches).toEqual([{ day: '2026-11-09', strain: 4, switches: 11 }]);
	});

	it('ranks tasks by switches per hour spent on them', () => {
		const i = insights([{ agg: monday, checkIn: {} }]);
		expect(i.fragmentation.map((f) => f.task)).toEqual([
			notebook.slack,
			notebook.mail,
			notebook.report,
			notebook.code
		]);
		expect(i.fragmentation[0].switchesPerHour).toBeCloseTo(3 / (25 / 60));
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
