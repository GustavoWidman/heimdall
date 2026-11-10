import type { DayView, Focus } from '#lib/app/app.svelte.ts';

const HOUR = 3_600_000;

/** Whole hours after the day's start, [lo, hi), that one scale shares across several days. */
export type HourWindow = { readonly lo: number; readonly hi: number };

/** When nothing was watched: the working day, 08:00 to 18:00 with a 04:00 day start. */
const QUIET: HourWindow = { lo: 4, hi: 14 };
const MIN_WIDTH = 8;

/**
 * The hours every day's activity falls in, widened to at least eight. `now` closes the
 * open stretch of a live day.
 */
export function sharedWindow(views: readonly DayView[], now: number): HourWindow {
	let lo = Infinity;
	let hi = -Infinity;
	for (const v of views) {
		const stretches: { start: number; end: number; focus: Focus }[] = v.segments.map((s) => ({
			start: s.start,
			end: s.end,
			focus: s.focus
		}));
		if (v.tail) stretches.push({ start: v.tail.start, end: now, focus: v.tail.focus });
		for (const s of stretches) {
			if (s.focus.k === 'off' || s.end <= s.start) continue;
			lo = Math.min(lo, (s.start - v.range.start) / HOUR);
			hi = Math.max(hi, (Math.min(s.end, v.range.end) - v.range.start) / HOUR);
		}
	}
	if (lo === Infinity) return QUIET;
	let a = Math.max(0, Math.floor(lo));
	let b = Math.min(24, Math.ceil(hi));
	if (b - a < MIN_WIDTH) {
		b = Math.min(24, a + MIN_WIDTH);
		a = Math.max(0, b - MIN_WIDTH);
	}
	return { lo: a, hi: b };
}
