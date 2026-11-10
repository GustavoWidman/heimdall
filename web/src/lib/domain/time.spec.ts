import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { DayKey, DayStartHour, Instant, Settings, TimeZone } from './model';
import {
	addDays,
	dayOf,
	daysBetween,
	hourIn,
	localHour,
	monthOf,
	rangeOf,
	weekday,
	weekOf
} from './time';

const HOUR = 3_600_000;
const at = (iso: string) => Date.parse(iso) as Instant;
const day = (s: string) => s as DayKey;
const settings = (zone: string, hour = 4): Settings => ({
	timeZone: zone as TimeZone,
	dayStartHour: hour as DayStartHour
});

const saoPaulo = settings('America/Sao_Paulo');
const newYork = settings('America/New_York');
const berlin = settings('Europe/Berlin');

describe('America/Sao_Paulo', () => {
	it('puts 01:30 local in the previous day when the day starts at 04:00', () => {
		expect(dayOf(at('2026-11-10T01:30:00-03:00'), saoPaulo)).toBe('2026-11-09');
		expect(dayOf(at('2026-11-10T03:59:59-03:00'), saoPaulo)).toBe('2026-11-09');
		expect(dayOf(at('2026-11-10T04:00:00-03:00'), saoPaulo)).toBe('2026-11-10');
		expect(dayOf(at('2026-11-10T23:59:00-03:00'), saoPaulo)).toBe('2026-11-10');
	});

	it('spans 04:00 to 04:00 local', () => {
		expect(rangeOf(day('2026-11-10'), saoPaulo)).toEqual({
			day: '2026-11-10',
			start: at('2026-11-10T07:00:00Z'),
			end: at('2026-11-11T07:00:00Z')
		});
	});

	it('starts after the gap when the start hour was skipped by the 2018 change at midnight', () => {
		const midnight = settings('America/Sao_Paulo', 0);
		const r = rangeOf(day('2018-11-04'), midnight);
		expect(r.start).toBe(at('2018-11-04T01:00:00-02:00'));
		expect(r.end - r.start).toBe(23 * HOUR);
		expect(rangeOf(day('2018-11-03'), midnight).end).toBe(r.start);
	});
});

describe('America/New_York across DST', () => {
	it('makes the fall-back day 25 hours long', () => {
		expect(rangeOf(day('2026-10-31'), newYork)).toEqual({
			day: '2026-10-31',
			start: at('2026-10-31T04:00:00-04:00'),
			end: at('2026-11-01T04:00:00-05:00')
		});
		expect(
			rangeOf(day('2026-10-31'), newYork).end - rangeOf(day('2026-10-31'), newYork).start
		).toBe(25 * HOUR);
	});

	it('puts both 01:30s of the fall-back night in the previous day', () => {
		expect(dayOf(at('2026-11-01T01:30:00-04:00'), newYork)).toBe('2026-10-31');
		expect(dayOf(at('2026-11-01T01:30:00-05:00'), newYork)).toBe('2026-10-31');
		expect(dayOf(at('2026-11-01T04:00:00-05:00'), newYork)).toBe('2026-11-01');
	});

	it('makes the spring-forward day 23 hours long', () => {
		const r = rangeOf(day('2026-03-07'), newYork);
		expect(r.start).toBe(at('2026-03-07T04:00:00-05:00'));
		expect(r.end).toBe(at('2026-03-08T04:00:00-04:00'));
		expect(r.end - r.start).toBe(23 * HOUR);
	});

	it('takes the first 01:00 when the day starts inside the repeated hour', () => {
		const one = settings('America/New_York', 1);
		expect(rangeOf(day('2026-11-01'), one).start).toBe(at('2026-11-01T01:00:00-04:00'));
		expect(dayOf(at('2026-11-01T01:30:00-05:00'), one)).toBe('2026-11-01');
		expect(dayOf(at('2026-11-01T00:59:00-04:00'), one)).toBe('2026-10-31');
	});
});

describe('Europe/Berlin across DST', () => {
	it('makes the fall-back day 25 hours long', () => {
		const r = rangeOf(day('2026-10-24'), berlin);
		expect(r.start).toBe(at('2026-10-24T04:00:00+02:00'));
		expect(r.end).toBe(at('2026-10-25T04:00:00+01:00'));
		expect(r.end - r.start).toBe(25 * HOUR);
	});

	it('starts after the gap when the start hour does not exist', () => {
		const two = settings('Europe/Berlin', 2);
		const r = rangeOf(day('2026-03-29'), two);
		expect(r.start).toBe(at('2026-03-29T03:00:00+02:00'));
		expect(dayOf(at('2026-03-29T01:59:00+01:00'), two)).toBe('2026-03-28');
		expect(dayOf(r.start, two)).toBe('2026-03-29');
	});

	it('reads local hours on a 25-hour day', () => {
		const r = rangeOf(day('2026-10-24'), berlin);
		expect(hourIn(at('2026-10-25T02:30:00+02:00'), r, berlin)).toBe(2);
		expect(hourIn(at('2026-10-25T02:30:00+01:00'), r, berlin)).toBe(2);
		expect(hourIn(at('2026-10-25T03:30:00+01:00'), r, berlin)).toBe(3);
	});
});

describe('days partition time', () => {
	const zones = ['America/Sao_Paulo', 'America/New_York', 'Europe/Berlin', 'Asia/Kolkata', 'UTC'];
	const arb = fc.record({
		t: fc.integer({ min: Date.UTC(2015, 0, 1), max: Date.UTC(2035, 0, 1) }),
		zone: fc.constantFrom(...zones),
		hour: fc.integer({ min: 0, max: 23 })
	});

	it('every instant falls inside the range of its own day, and ranges tile', () => {
		fc.assert(
			fc.property(arb, ({ t, zone, hour }) => {
				const s = settings(zone, hour);
				const d = dayOf(t as Instant, s);
				const r = rangeOf(d, s);
				expect(r.start).toBeLessThanOrEqual(t);
				expect(t).toBeLessThan(r.end);
				expect(rangeOf(addDays(d, 1), s).start).toBe(r.end);
				expect(dayOf(r.start, s)).toBe(d);
				expect(dayOf((r.end - 1) as Instant, s)).toBe(d);
				expect(hourIn(t as Instant, r, s)).toBe(localHour(t as Instant, s));
			}),
			{ numRuns: 2000 }
		);
	});
});

describe('calendar helpers', () => {
	it('adds days across month and year ends', () => {
		expect(addDays(day('2026-12-31'), 1)).toBe('2027-01-01');
		expect(addDays(day('2024-03-01'), -1)).toBe('2024-02-29');
	});

	it('finds the Monday-to-Sunday week and the month', () => {
		expect(weekday(day('2026-11-10'))).toBe(1);
		expect(weekOf(day('2026-11-10'))).toEqual({ from: '2026-11-09', to: '2026-11-15' });
		expect(monthOf(day('2024-02-10'))).toEqual({ from: '2024-02-01', to: '2024-02-29' });
		expect(daysBetween(day('2026-12-30'), day('2027-01-02'))).toEqual([
			'2026-12-30',
			'2026-12-31',
			'2027-01-01',
			'2027-01-02'
		]);
	});
});
