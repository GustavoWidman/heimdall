const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const clocks = new Map<string, Intl.DateTimeFormat>();
const weekdays = new Map<string, Intl.DateTimeFormat>();

function clockFormat(zone: string): Intl.DateTimeFormat {
	let f = clocks.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-GB', {
			timeZone: zone,
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		});
		clocks.set(zone, f);
	}
	return f;
}

/** `15:42` in the given zone. */
export function clock(at: number, zone: string): string {
	return clockFormat(zone).format(at);
}

/** Minutes since local midnight in the given zone. */
export function minuteOfDay(at: number, zone: string): number {
	const [h, m] = clock(at, zone).split(':').map(Number);
	return h * 60 + m;
}

/** `tue 14:00` or `12 dec` for a deadline beyond today. */
function dayAndTime(at: number, zone: string, now: number): string {
	let f = weekdays.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short' });
		weekdays.set(zone, f);
	}
	if (at - now < 6 * DAY) return `${f.format(at).toLowerCase()} ${clock(at, zone)}`;
	return new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short' })
		.format(at)
		.toLowerCase();
}

/** `24m`, `1h24`. Time spent. */
export function spent(ms: number): string {
	const m = Math.floor(ms / MINUTE);
	return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

/** `45m`, `2h 10m`, `3d`. Time remaining. */
export function remaining(ms: number): string {
	const m = Math.max(0, Math.round(ms / MINUTE));
	if (m < 60) return `${m}m`;
	if (m < 48 * 60) return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
	return `${Math.round(m / (24 * 60))}d`;
}

/** The live timer split so seconds can be dimmed: `24` `:11`, or `1:24` `:11`. */
export function timer(ms: number): { readonly main: string; readonly seconds: string } {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor(s / 60) % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return { main: h ? `${h}:${pad(m)}` : pad(m), seconds: pad(s % 60) };
}

/** `tue 10 nov` from a `YYYY-MM-DD` day key. */
export function dayLabel(day: string): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: 'UTC',
		weekday: 'short',
		day: 'numeric',
		month: 'short'
	})
		.format(Date.UTC(y, m - 1, d))
		.replace(',', '')
		.toLowerCase();
}

export type DeadlineLabel = {
	readonly text: string;
	/** Due within three hours: shown in the task's hue. */
	readonly near: boolean;
};

/** How a deadline reads next to a task. Past deadlines are stated, never flagged. */
export function deadlineLabel(deadline: number, now: number, zone: string): DeadlineLabel {
	const left = deadline - now;
	if (left < 0) {
		const when = -left < DAY ? clock(deadline, zone) : dayAndTime(deadline, zone, deadline);
		return { text: `was due ${when}`, near: false };
	}
	if (left < 18 * HOUR) {
		return { text: `due ${clock(deadline, zone)} · ${remaining(left)}`, near: left < 3 * HOUR };
	}
	return { text: `due ${dayAndTime(deadline, zone, now)}`, near: false };
}

/** The local value of a datetime-local input for an instant, in the device zone. */
export function toLocalInput(at: number): string {
	const d = new Date(at - new Date(at).getTimezoneOffset() * MINUTE);
	return d.toISOString().slice(0, 16);
}

export { HOUR, MINUTE };
