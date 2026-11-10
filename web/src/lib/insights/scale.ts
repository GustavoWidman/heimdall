import type { DayKey, SeriesPoint } from '#lib/app/app.svelte.ts';

/** A round top for a value axis, and the gridlines under it, starting at 0. */
export function niceAxis(
	max: number,
	lines = 3
): { readonly max: number; readonly ticks: number[] } {
	if (!(max > 0)) return { max: 1, ticks: [0] };
	const raw = max / lines;
	const pow = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
	const top = Math.ceil(max / step) * step;
	const ticks: number[] = [];
	for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
	return { max: top, ticks };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function parts(day: DayKey) {
	const [y, m, d] = day.split('-').map(Number);
	return { m, d, w: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 };
}

/**
 * Which days of a run get an x-axis label, and what it says. A week names every weekday, a
 * month labels Mondays, and anything longer labels the first of each month.
 */
export function dayTicks(days: readonly DayKey[]): Map<number, string> {
	const out = new Map<number, string>();
	days.forEach((day, i) => {
		const { m, d, w } = parts(day);
		if (days.length <= 7) out.set(i, WEEKDAYS[w]);
		else if (days.length <= 45) {
			if (w === 0) out.set(i, `${d} ${MONTHS[m - 1]}`);
		} else if (d === 1) out.set(i, MONTHS[m - 1]);
	});
	return out;
}

export type ReasonKey = 'urge' | 'pulled' | 'done' | 'blocked' | 'untagged';

export type Bucket = {
	readonly key: DayKey;
	/** Last day in the bucket. Equal to key for a one-day bucket. */
	readonly to: DayKey;
	readonly switches: number;
	readonly reasons: Readonly<Record<ReasonKey, number>>;
};

/** Axis labels for week buckets: the month name on the week its first day falls in. */
export function weekTicks(buckets: readonly Bucket[]): Map<number, string> {
	const out = new Map<number, string>();
	buckets.forEach((b, i) => {
		const from = parts(b.key);
		const to = parts(b.to);
		if (from.d === 1 || (to.m !== from.m && i > 0)) out.set(i, MONTHS[to.m - 1]);
	});
	return out;
}

/** Days as they are for a month or less; Monday-to-Sunday weeks beyond that. */
export function reasonBuckets(series: readonly SeriesPoint[]): Bucket[] {
	const weekly = series.length > 45;
	const out: { key: DayKey; to: DayKey; switches: number; reasons: Record<ReasonKey, number> }[] =
		[];
	for (const p of series) {
		const last = out.at(-1);
		if (last && weekly && parts(p.day).w !== 0) {
			last.to = p.day;
			last.switches += p.switches;
			for (const r of Object.keys(last.reasons) as ReasonKey[]) last.reasons[r] += p.reasons[r];
		} else {
			out.push({ key: p.day, to: p.day, switches: p.switches, reasons: { ...p.reasons } });
		}
	}
	return out;
}
