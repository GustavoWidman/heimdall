import { describe, expect, it } from 'vitest';
import type { DayKey, SeriesPoint } from '#lib/app/app.svelte.ts';
import { dayTicks, niceAxis, reasonBuckets, weekTicks } from './scale';

const run = (from: string, n: number) =>
	Array.from(
		{ length: n },
		(_, k) =>
			new Date(Date.parse(`${from}T12:00:00Z`) + k * 86_400_000)
				.toISOString()
				.slice(0, 10) as DayKey
	);

describe('niceAxis', () => {
	it('rounds the top up to a clean step and lists gridlines from zero', () => {
		expect(niceAxis(37)).toEqual({ max: 40, ticks: [0, 20, 40] });
		expect(niceAxis(9)).toEqual({ max: 10, ticks: [0, 5, 10] });
		expect(niceAxis(4)).toEqual({ max: 4, ticks: [0, 2, 4] });
		expect(niceAxis(120)).toEqual({ max: 150, ticks: [0, 50, 100, 150] });
	});

	it('gives an empty chart a unit axis', () => {
		expect(niceAxis(0)).toEqual({ max: 1, ticks: [0] });
	});
});

describe('dayTicks', () => {
	it('names every weekday in a week', () => {
		expect([...dayTicks(run('2026-11-04', 7)).values()]).toEqual([
			'wed',
			'thu',
			'fri',
			'sat',
			'sun',
			'mon',
			'tue'
		]);
	});

	it('labels mondays across a month and month starts across a quarter', () => {
		expect([...dayTicks(run('2026-10-12', 30)).values()]).toEqual([
			'12 oct',
			'19 oct',
			'26 oct',
			'2 nov',
			'9 nov'
		]);
		expect([...dayTicks(run('2026-08-13', 90)).values()]).toEqual(['sep', 'oct', 'nov']);
	});
});

describe('reasonBuckets', () => {
	const point = (day: DayKey, urge: number): SeriesPoint => ({
		day,
		tracked: true,
		switches: urge + 1,
		focusMs: 0,
		juggleMs: 0,
		restMs: 0,
		reasons: { done: 0, blocked: 0, urge, pulled: 0, untagged: 1 },
		stretchMedianMs: null,
		stretchLongestMs: null,
		strain: null,
		stress: null,
		headache: null
	});

	it('keeps days as they are for a month', () => {
		const days = run('2026-11-01', 30).map((d) => point(d, 2));
		expect(reasonBuckets(days)).toHaveLength(30);
	});

	it('sums a longer run into monday-to-sunday weeks', () => {
		const days = run('2026-08-13', 90).map((d) => point(d, 1));
		const weeks = reasonBuckets(days);
		expect(weeks[0]).toMatchObject({ key: '2026-08-13', to: '2026-08-16', switches: 8 });
		expect(weeks[1]).toMatchObject({ key: '2026-08-17', to: '2026-08-23' });
		expect(weeks[1].reasons).toEqual({ done: 0, blocked: 0, urge: 7, pulled: 0, untagged: 7 });
		expect(weeks.reduce((n, w) => n + w.switches, 0)).toBe(180);
	});

	it('labels each week by the month that begins in it', () => {
		const weeks = reasonBuckets(run('2026-08-13', 90).map((d) => point(d, 1)));
		const labels = weekTicks(weeks);
		expect([...labels.values()]).toEqual(['sep', 'oct', 'nov']);
		expect(weeks[[...labels.keys()][0]]).toMatchObject({ key: '2026-08-31', to: '2026-09-06' });
	});
});
