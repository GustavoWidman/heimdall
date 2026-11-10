import { describe, expect, it } from 'vitest';
import { parseCheckIn } from '../domain/checkin';
import { deriveDay, FOLD_START } from '../domain/focus';
import type { DayKey, Instant, Mark, MarkId, TaskId } from '../domain/model';
import { aggregateDay, rollup, type DaySummary } from '../domain/stats';
import { rangeOf } from '../domain/time';
import { contrast } from './compare';
import { ledger } from './ledger';
import { level, METRICS, weekGrid } from './metrics';
import {
	isDayKey,
	isMonthKey,
	isoWeek,
	monthSpan,
	shiftMonth,
	spanTitle,
	yearSpan
} from './period';
import { sharedWindow } from './strip';
import { settings, day as notebookDay, local, mail, report } from '../domain/notebook-day.fixture';

const day = (s: string) => s as DayKey;
const MIN = 60_000;

function mark(id: string, at: Instant, task: TaskId | null, voided = false): Mark {
	return {
		id: id as MarkId,
		at,
		gesture: task ? { k: 'tap', task } : { k: 'rest' },
		voided,
		reason: null
	};
}

const range = rangeOf(notebookDay, settings);
const marks = [
	mark('a', local(notebookDay, '09:00'), mail),
	mark('b', local(notebookDay, '09:30'), report),
	mark('c', local(notebookDay, '09:40'), mail, true),
	mark('d', local(notebookDay, '10:00'), null),
	mark('e', local(notebookDay, '10:15'), report),
	{ ...mark('f', local(notebookDay, '11:00'), null), gesture: { k: 'off' as const } }
];
const view = deriveDay(marks, range, FOLD_START, false);

describe('the ledger', () => {
	it('keeps every mark in order and joins what each did', () => {
		const rows = ledger(marks, view.transitions);
		expect(rows.map((r) => [r.mark.id, r.voided ? 'voided' : r.kind])).toEqual([
			['a', 'start'],
			['b', 'switch'],
			['c', 'voided'],
			['d', 'rest'],
			['e', 'resume'],
			['f', 'off']
		]);
	});

	it('shows where a switch came from and went to', () => {
		const b = ledger(marks, view.transitions)[1];
		expect(b.voided ? null : [b.from, b.to]).toEqual([
			{ k: 'working', tasks: [mail] },
			{ k: 'working', tasks: [report] }
		]);
	});
});

describe('period keys', () => {
	it('accepts only real dates', () => {
		expect(isDayKey('2026-11-10')).toBe(true);
		expect(isDayKey('2028-02-29')).toBe(true);
		expect(isDayKey('2026-02-29')).toBe(false);
		expect(isDayKey('2026-13-01')).toBe(false);
		expect(isDayKey('2026-1-01')).toBe(false);
		expect(isMonthKey('2026-11')).toBe(true);
		expect(isMonthKey('2026-00')).toBe(false);
	});

	it('steps months across years', () => {
		expect(shiftMonth('2026-12', 1)).toBe('2027-01');
		expect(shiftMonth('2026-01', -1)).toBe('2025-12');
		expect(monthSpan('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
		expect(yearSpan('2026')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
	});

	it('names weeks the ISO way', () => {
		expect(isoWeek(day('2026-11-10'))).toBe(46);
		expect(isoWeek(day('2027-01-01'))).toBe(53);
		expect(isoWeek(day('2026-01-01'))).toBe(1);
		expect(isoWeek(day('2024-12-30'))).toBe(1);
	});

	it('titles a span without repeating what is shared', () => {
		expect(spanTitle({ from: day('2026-11-09'), to: day('2026-11-15') })).toBe('9 – 15 nov');
		expect(spanTitle({ from: day('2026-11-30'), to: day('2026-12-06') })).toBe('30 nov – 6 dec');
		expect(spanTitle({ from: day('2026-12-28'), to: day('2027-01-03') })).toBe(
			'28 dec 2026 – 3 jan 2027'
		);
	});
});

describe('the week next to the week before', () => {
	const totals = (switches: number, focusMin: number, juggleMin = 0) =>
		rollup([
			{
				...aggregateDay(view, settings),
				switches,
				focusMs: focusMin * MIN,
				juggleMs: juggleMin * MIN
			}
		]);

	it('describes differences without grading them', () => {
		expect(contrast(totals(30, 600, 60), totals(18, 520, 62), false)).toEqual([
			'12 more switches than last week',
			'1h20 more focus than last week',
			'about the same juggling as last week'
		]);
		expect(contrast(totals(17, 300), totals(18, 400), true)).toEqual([
			'1 fewer switch than by this point last week',
			'1h40 less focus than by this point last week',
			'about the same juggling as by this point last week'
		]);
	});

	it('says so when there is no week before to compare with', () => {
		expect(contrast(totals(3, 60), rollup([]), false)).toHaveLength(1);
	});
});

describe('heatmap metrics', () => {
	const summary = (agg = aggregateDay(view, settings), answers = {}): DaySummary => ({
		agg,
		checkIn: parseCheckIn(answers)
	});

	it('reads a day with nothing watched as no data, not as zero', () => {
		const empty = aggregateDay(deriveDay([], range, FOLD_START, false), settings);
		expect(METRICS.switches.value(summary(empty))).toBeNull();
		expect(METRICS.switches.value(summary())).toBe(1);
		expect(METRICS.strain.value(summary())).toBeNull();
		expect(METRICS.strain.value(summary(undefined, { strain: 4 }))).toBe(4);
	});

	it('shades from lightest to darkest across the scale', () => {
		expect([null, 0, 1, 6, 12, 40].map((v) => level(v, 0, 12))).toEqual([null, 0, 1, 2, 4, 4]);
		expect([1, 2, 3, 4, 5].map((v) => level(v, 1, 5))).toEqual([0, 1, 2, 3, 4]);
	});

	it('formats a value with the check-in’s own words', () => {
		expect(METRICS.headache.format(2)).toBe('headache moderate');
		expect(METRICS.focus.format(84 * MIN)).toBe('1h24 focus');
	});

	it('lays a year out in Monday-first week columns', () => {
		const g = weekGrid(day('2026-01-01'), day('2026-12-31'));
		expect(g.cells).toHaveLength(365);
		expect(g.cells[0]).toEqual({ day: '2026-01-01', col: 0, row: 3 });
		expect(g.cells.find((c) => c.day === '2026-01-05')).toEqual({
			day: '2026-01-05',
			col: 1,
			row: 0
		});
		expect(g.cols).toBe(53);
	});
});

describe('the shared hour scale of a week', () => {
	it('spans every day’s activity in whole hours', () => {
		const w = sharedWindow([view], range.end);
		expect(w).toEqual({ lo: 5, hi: 13 });
	});

	it('falls back to the working day when nothing was watched', () => {
		expect(sharedWindow([deriveDay([], range, FOLD_START, false)], range.end)).toEqual({
			lo: 4,
			hi: 14
		});
	});

	it('counts a live day’s open stretch up to now', () => {
		const live = deriveDay(marks.slice(0, 2), range, FOLD_START, true);
		expect(sharedWindow([live], local(notebookDay, '21:10'))).toEqual({ lo: 5, hi: 18 });
	});
});
