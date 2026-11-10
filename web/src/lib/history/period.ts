import type { DayKey } from '../domain/model';
import {
	addDays,
	daysBetween,
	daysFrom,
	monthOf,
	weekday,
	weekOf,
	type DaySpan
} from '../domain/time';

export { addDays, daysBetween, weekday, weekOf, type DaySpan };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;

/** A real calendar date written as `YYYY-MM-DD`. */
export function isDayKey(s: string): s is DayKey {
	const m = DAY.exec(s);
	if (!m) return false;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export const isMonthKey = (s: string): boolean => MONTH.test(s);
export const isYearKey = (s: string): boolean => YEAR.test(s);

export const monthKeyOf = (day: DayKey): string => day.slice(0, 7);
export const yearKeyOf = (day: DayKey): string => day.slice(0, 4);

export function monthSpan(month: string): DaySpan {
	return monthOf(`${month}-01` as DayKey);
}

export function yearSpan(year: string): DaySpan {
	return { from: `${year}-01-01` as DayKey, to: `${year}-12-31` as DayKey };
}

export function shiftMonth(month: string, n: number): string {
	const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
	const y = Math.floor(i / 12);
	return `${String(y).padStart(4, '0')}-${String(i - y * 12 + 1).padStart(2, '0')}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const LONG_MONTHS = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december'
];
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const monthShort = (month: string): string => MONTHS[Number(month.slice(5, 7)) - 1];

/** `november 2026`. */
export function monthTitle(month: string): string {
	return `${LONG_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** `9 – 15 nov`, `30 nov – 6 dec` across months, with years across a new year. */
export function spanTitle(span: DaySpan): string {
	const [fy, fm, fd] = span.from.split('-').map(Number);
	const [ty, tm, td] = span.to.split('-').map(Number);
	if (fy !== ty) return `${fd} ${MONTHS[fm - 1]} ${fy} – ${td} ${MONTHS[tm - 1]} ${ty}`;
	if (fm !== tm) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]}`;
	return `${fd} – ${td} ${MONTHS[tm - 1]}`;
}

/** The ISO 8601 week number, 1..53: the week holding that week's Thursday. */
export function isoWeek(day: DayKey): number {
	const thursday = addDays(day, 3 - weekday(day));
	return Math.floor(daysFrom(`${thursday.slice(0, 4)}-01-01` as DayKey, thursday) / 7) + 1;
}
