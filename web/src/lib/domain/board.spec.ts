import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { boardOrder, deriveBoard, pressure, rankBetween, suggestPlan } from './board';
import { carryIn, deriveDay } from './focus';
import type { DayKey, Hue, Instant, MarkId, PlanEntry, Task, TaskId, Title } from './model';
import { rangeOf } from './time';
import { local, settings } from './notebook-day.fixture';

const DAY = '2026-11-09' as DayKey;
const HOUR = 3_600_000;

function task(id: string, extra: Partial<Task> = {}): Task {
	return {
		id: id as TaskId,
		title: id as Title,
		note: null,
		hue: 0 as Hue,
		deadline: null,
		longRunning: false,
		status: 'active',
		createdAt: 0 as Instant,
		...extra
	};
}

const plan = (day: string, t: string, rank: string, on = true): PlanEntry => ({
	day: day as DayKey,
	task: t as TaskId,
	rank,
	on
});

describe('deriveBoard', () => {
	const tasks = new Map(
		[task('t_a'), task('t_b'), task('t_c'), task('t_x'), task('t_y')].map((t) => [t.id, t])
	);
	const range = rangeOf(DAY, settings);
	const marks = [
		{
			id: 'm_1' as MarkId,
			at: local(DAY, '09:00'),
			gesture: { k: 'tap', task: 't_y' as TaskId },
			voided: false,
			reason: null
		},
		{
			id: 'm_2' as MarkId,
			at: local(DAY, '09:30'),
			gesture: { k: 'tap', task: 't_b' as TaskId },
			voided: false,
			reason: null
		},
		{
			id: 'm_3' as MarkId,
			at: local(DAY, '10:00'),
			gesture: { k: 'hold', task: 't_x' as TaskId },
			voided: false,
			reason: null
		}
	] as const;
	const view = deriveDay(marks, range, carryIn(marks, range.start), true);
	const entries = [
		plan(DAY, 't_c', 'm'),
		plan(DAY, 't_a', 'c'),
		plan(DAY, 't_b', 'h'),
		plan(DAY, 't_z', 'a'),
		plan(DAY, 't_x', 'b', false)
	];
	const rows = deriveBoard(tasks, entries, view, local(DAY, '10:30'));

	it('lists planned tasks by rank, then touched tasks in the order first touched', () => {
		expect(rows.map((r) => [r.task.id, r.planned])).toEqual([
			['t_a', true],
			['t_b', true],
			['t_c', true],
			['t_y', false],
			['t_x', false]
		]);
	});

	it('shows ticks and focus on each row', () => {
		const b = rows.find((r) => r.task.id === 't_b');
		expect(b?.day.ticks).toBe(1);
		expect(b?.inFocus).toBe(true);
		expect(rows.find((r) => r.task.id === 't_y')?.inFocus).toBe(false);
	});
});

describe('pressure', () => {
	const now = 1_000_000_000 as Instant;
	it.each([
		[null, 'none'],
		[now - 1, 'overdue'],
		[now + 23 * HOUR, 'today'],
		[now + 48 * HOUR, 'soon'],
		[now + 5 * 24 * HOUR, 'week'],
		[now + 8 * 24 * HOUR, 'later']
	] as const)('deadline %s reads %s', (deadline, label) => {
		expect(pressure(deadline as Instant | null, now)).toBe(label);
	});
});

describe('suggestPlan', () => {
	it('offers yesterday’s active planned tasks, then long-running ones by deadline', () => {
		const tasks = new Map(
			[
				task('t_done', { status: 'done' }),
				task('t_open'),
				task('t_today'),
				task('t_long_late', { longRunning: true, deadline: 5000 as Instant }),
				task('t_long_soon', { longRunning: true, deadline: 1000 as Instant }),
				task('t_long_carried', { longRunning: true }),
				task('t_long_archived', { longRunning: true, status: 'archived' })
			].map((t) => [t.id, t])
		);
		const yesterday = [
			plan('2026-11-08', 't_long_carried', 'b'),
			plan('2026-11-08', 't_open', 'a'),
			plan('2026-11-08', 't_done', 'c'),
			plan('2026-11-08', 't_today', 'd')
		];
		const today = [plan(DAY, 't_today', 'a')];
		const s = suggestPlan(tasks, today, yesterday);
		expect(s.carryOver.map((t) => t.id)).toEqual(['t_open', 't_long_carried']);
		expect(s.backlog.map((t) => t.id)).toEqual(['t_long_soon', 't_long_late']);
	});
});

describe('rankBetween', () => {
	const rank = fc.stringMatching(/^[0-9a-z]{0,6}[1-9a-z]$/);

	it('always finds a rank strictly between two ranks', () => {
		fc.assert(
			fc.property(rank, rank, (x, y) => {
				fc.pre(x !== y);
				const [lo, hi] = x < y ? [x, y] : [y, x];
				const r = rankBetween(lo, hi);
				expect(lo < r && r < hi).toBe(true);
				expect(r.endsWith('0')).toBe(false);
			}),
			{ numRuns: 2000 }
		);
	});

	it('keeps order through repeated inserts at the front, the back, and the middle', () => {
		let ranks = [rankBetween(null, null)];
		for (let i = 0; i < 50; i++) {
			ranks = [rankBetween(null, ranks[0]), ...ranks, rankBetween(ranks.at(-1)!, null)];
			const mid = ranks.length >> 1;
			ranks.splice(mid, 0, rankBetween(ranks[mid - 1], ranks[mid]));
		}
		expect([...ranks].sort()).toEqual(ranks);
		expect(new Set(ranks).size).toBe(ranks.length);
	});

	it('accepts ranks written with trailing zeros', () => {
		const r = rankBetween('a0', 'b');
		expect('a0' < r && r < 'b').toBe(true);
	});

	it('refuses two equal ranks, so the caller can renumber', () => {
		expect(() => rankBetween('h', 'h')).toThrow(RangeError);
	});

	it('breaks rank ties by task id', () => {
		expect(boardOrder([plan(DAY, 't_b', 'h'), plan(DAY, 't_a', 'h')]).map((p) => p.task)).toEqual([
			't_a',
			't_b'
		]);
	});
});
