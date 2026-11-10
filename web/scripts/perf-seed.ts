/**
 * A year of plausible history as sync ops, built from the domain's own types and stamped
 * with the replica's clock: about 25k marks, 300 check-ins, a task every three days, and a
 * planned board of up to eight tasks each day. Seeded, so every run pushes the same shape.
 * Today holds 40 marks up to a minute ago, its last one a tap, so the board has a focus.
 */
import { CHECKIN_FIELDS, CHECKIN_KEYS } from '../src/lib/domain/checkin.ts';
import { REASONS, type DayKey, type Instant, type Settings } from '../src/lib/domain/model.ts';
import { addDays, dayOf, rangeOf } from '../src/lib/domain/time.ts';
import { Clock, stamp, type Change, type Op } from '../src/lib/replica/op.ts';

const DAYS = 365;
const MARKS = 25_000;
const CHECKINS = 300;
const BOARD = 8;
/** Fixed, so a run at 5 am and one at 9 pm derive the same size of day. */
const TODAY_MARKS = 40;
const TASK_EVERY_DAYS = 3;
const TASK_LIFE_DAYS = 24;
const HOUR = 3_600_000;

function rng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export type Seed = {
	readonly ops: Op[];
	readonly counts: {
		readonly marks: number;
		readonly checkins: number;
		readonly tasks: number;
		readonly plans: number;
	};
	readonly today: DayKey;
};

export function seedYear(now: number, timeZone: string, seed = 1): Seed {
	const rand = rng(seed);
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
	const settings = { timeZone, dayStartHour: 4 } as Settings;
	const today = dayOf(now as Instant, settings);
	const first = addDays(today, 1 - DAYS);
	const events: { at: number; change: Change }[] = [];
	const push = (at: number, change: Change) => events.push({ at, change });
	let n = 0;
	const id = (p: string) => `${p}_perf${(n++).toString(36).padStart(8, '0')}`;

	push(rangeOf(first, settings).start - HOUR, {
		kind: 'settings',
		id: 'user',
		set: settings
	} as Change);

	type T = { id: string; born: number; dies: number };
	const tasks: T[] = [];
	const counts = { marks: 0, checkins: 0, tasks: 0, plans: 0 };
	const pastDays = DAYS - 1;
	const checkinDays = new Set<number>();
	while (checkinDays.size < CHECKINS) checkinDays.add(Math.floor(rand() * pastDays));
	const perDay = (MARKS - TODAY_MARKS) / (DAYS - 1);

	for (let d = 0; d < DAYS; d++) {
		const day = addDays(first, d);
		const { start } = rangeOf(day, settings);
		const isToday = day === today;
		if (d % TASK_EVERY_DAYS === 0 || tasks.length < BOARD) {
			const t = { id: id('t'), born: d, dies: d + TASK_LIFE_DAYS + Math.floor(rand() * 20) };
			tasks.push(t);
			counts.tasks++;
			const due = rand() < 0.25 ? start + (5 + Math.floor(rand() * 30)) * 24 * HOUR : null;
			push(start + HOUR, {
				kind: 'task',
				id: t.id,
				set: {
					title: `task ${counts.tasks} · ${pick(['report', 'inbox', 'thesis', 'review', 'call', 'errand', 'reading', 'fix'])}`,
					note: null,
					hue: (counts.tasks * 137) % 360,
					deadline: due,
					longRunning: rand() < 0.15,
					status: 'active',
					createdAt: start + HOUR
				}
			} as Change);
		}
		for (const t of tasks) {
			if (t.dies === d)
				push(start + 2 * HOUR, {
					kind: 'task',
					id: t.id,
					set: { status: rand() < 0.8 ? 'done' : 'archived' }
				} as Change);
		}
		const board = tasks.filter((t) => t.born <= d && t.dies > d).slice(-BOARD);
		board.forEach((t, i) => {
			counts.plans++;
			push(start + 3 * HOUR, {
				kind: 'plan',
				id: `${day}:${t.id}`,
				set: { on: true, rank: `a${i.toString(36)}` }
			} as Change);
		});

		const from = start + 4 * HOUR;
		const to = isToday ? now - 60_000 : start + 19 * HOUR;
		const want = isToday ? TODAY_MARKS : Math.round(perDay * (0.75 + rand() * 0.5));
		const lo = isToday ? start : from;
		const times = Array.from({ length: want }, () => lo + rand() * (to - lo)).sort((a, b) => a - b);
		let focus: string | null = null;
		times.forEach((at, i) => {
			const last = i === times.length - 1;
			let gesture: Record<string, unknown>;
			const r = rand();
			if (last && !isToday) gesture = { k: 'off' };
			else if (r < 0.06 && !last) gesture = { k: 'rest' };
			else if (r < 0.14 && !last) gesture = { k: 'hold', task: pick(board).id };
			else if (r < 0.18 && !last && focus) gesture = { k: 'release', task: focus };
			else {
				const choices = board.filter((t) => t.id !== focus);
				const t = pick(choices.length ? choices : board);
				focus = t.id;
				gesture = { k: 'tap', task: t.id };
			}
			counts.marks++;
			push(Math.round(at), {
				kind: 'mark',
				id: id('m'),
				set: {
					at: Math.round(at),
					gesture,
					voided: rand() < 0.02,
					reason: rand() < 0.3 ? pick(REASONS) : null
				}
			} as Change);
		});

		if (checkinDays.has(d) && !isToday) {
			const set: Record<string, unknown> = {};
			for (const key of CHECKIN_KEYS) {
				const f = CHECKIN_FIELDS[key] as { kind: string; values?: readonly unknown[] };
				if ((f.kind === 'scale' || f.kind === 'choice') && f.values && rand() < 0.9)
					set[key] = pick(f.values);
			}
			counts.checkins++;
			push(start + 20 * HOUR, { kind: 'checkin', id: day, set } as Change);
		}
	}

	events.sort((a, b) => a.at - b.at);
	const clock = new Clock('perfseed00');
	return { ops: events.map((e) => stamp(e.change, clock.tick(e.at))), counts, today };
}
