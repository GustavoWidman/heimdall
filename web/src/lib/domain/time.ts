import type { DayKey, Instant, Settings, TimeZone } from './model';

/** The instants a day covers, [start, end). 23 or 25 hours long on DST days. */
export type DayRange = {
	readonly day: DayKey;
	readonly start: Instant;
	readonly end: Instant;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: TimeZone): Intl.DateTimeFormat {
	let f = formatters.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		});
		formatters.set(zone, f);
	}
	return f;
}

type Wall = { y: number; m: number; d: number; h: number; mi: number; s: number };

function wall(at: number, zone: TimeZone): Wall {
	const w: Wall = { y: 0, m: 0, d: 0, h: 0, mi: 0, s: 0 };
	for (const p of formatter(zone).formatToParts(at)) {
		switch (p.type) {
			case 'year':
				w.y = Number(p.value);
				break;
			case 'month':
				w.m = Number(p.value);
				break;
			case 'day':
				w.d = Number(p.value);
				break;
			case 'hour':
				w.h = Number(p.value);
				break;
			case 'minute':
				w.mi = Number(p.value);
				break;
			case 'second':
				w.s = Number(p.value);
				break;
		}
	}
	return w;
}

/** Local wall-clock time minus UTC, in ms, at an instant. */
function offsetAt(at: number, zone: TimeZone): number {
	const w = wall(at, zone);
	return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(at / 1000) * 1000;
}

function pad(n: number, width: number): string {
	return String(n).padStart(width, '0');
}

function keyOf(y: number, m: number, d: number): DayKey {
	return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}` as DayKey;
}

function utcMidnight(day: DayKey): number {
	return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

function keyOfUtc(ms: number): DayKey {
	const d = new Date(ms);
	return keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * The day an instant belongs to: its local date, or the previous date when the local hour
 * is before the day-start hour. Comparing wall-clock hours (rather than shifting the
 * instant by the start hour) stays right on days that are 23 or 25 hours long.
 */
export function dayOf(at: Instant, s: Settings): DayKey {
	const w = wall(at, s.timeZone);
	const key = keyOf(w.y, w.m, w.d);
	return w.h < s.dayStartHour ? addDays(key, -1) : key;
}

/** Local hour 0..23 of an instant. */
export function localHour(at: Instant, s: Settings): number {
	return wall(at, s.timeZone).h;
}

/**
 * Local hour of an instant inside a range. A 24-hour range has one UTC offset throughout,
 * so the hour is arithmetic and skips Intl, which dominates the cost of aggregating a year.
 */
export function hourIn(at: Instant, range: DayRange, s: Settings): number {
	if (range.end - range.start !== DAY) return localHour(at, s);
	return (s.dayStartHour + Math.floor((at - range.start) / HOUR)) % 24;
}

/**
 * The instant at local `hour`:00 on `day`. When that wall time occurs twice (fall back)
 * this is the first occurrence; when it does not exist (spring forward) this is the
 * first instant after the gap.
 */
function localToInstant(day: DayKey, hour: number, zone: TimeZone): Instant {
	const target = utcMidnight(day) + hour * HOUR;
	const before = offsetAt(target - DAY, zone);
	const after = offsetAt(target + DAY, zone);
	let best: number | null = null;
	for (const off of [before, after]) {
		const t = target - off;
		if (t + offsetAt(t, zone) === target && (best === null || t < best)) best = t;
	}
	return (best ?? target - before) as Instant;
}

const ranges = new Map<string, DayRange>();

export function rangeOf(day: DayKey, s: Settings): DayRange {
	const key = `${day}|${s.timeZone}|${s.dayStartHour}`;
	let r = ranges.get(key);
	if (!r) {
		if (ranges.size > 4096) ranges.clear();
		r = {
			day,
			start: localToInstant(day, s.dayStartHour, s.timeZone),
			end: localToInstant(addDays(day, 1), s.dayStartHour, s.timeZone)
		};
		ranges.set(key, r);
	}
	return r;
}

/** Calendar arithmetic on the key. No time zone is involved. */
export function addDays(day: DayKey, n: number): DayKey {
	return keyOfUtc(utcMidnight(day) + n * DAY);
}

/** 0 = Monday .. 6 = Sunday. */
export function weekday(day: DayKey): number {
	return (new Date(utcMidnight(day)).getUTCDay() + 6) % 7;
}

/** Whole days from `a` to `b`. */
export function daysFrom(a: DayKey, b: DayKey): number {
	return Math.round((utcMidnight(b) - utcMidnight(a)) / DAY);
}

/** Inclusive, ascending. Empty when `to` is before `from`. */
export function daysBetween(from: DayKey, to: DayKey): DayKey[] {
	const out: DayKey[] = [];
	for (let i = 0, n = daysFrom(from, to); i <= n; i++) out.push(addDays(from, i));
	return out;
}

export type DaySpan = { readonly from: DayKey; readonly to: DayKey };

/** The Monday-to-Sunday week holding `day`. */
export function weekOf(day: DayKey): DaySpan {
	const from = addDays(day, -weekday(day));
	return { from, to: addDays(from, 6) };
}

/** The calendar month holding `day`. */
export function monthOf(day: DayKey): DaySpan {
	const y = Number(day.slice(0, 4));
	const m = Number(day.slice(5, 7));
	return { from: keyOf(y, m, 1), to: keyOfUtc(Date.UTC(y, m, 0)) };
}
