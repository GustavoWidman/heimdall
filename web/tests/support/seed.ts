import type { APIRequestContext } from '@playwright/test';
import { PASSWORD } from './server';

/** Every test runs in this zone, so wall-clock strings below mean the same instant everywhere. */
export const ZONE = 'America/Sao_Paulo';
const OFFSET = '-03:00';

export const TODAY = '2026-11-10';

/** The instant of a wall-clock time in the test zone. */
export function at(day: string, hhmm: string): number {
	return Date.parse(`${day}T${hhmm}:00${OFFSET}`);
}

export function addDays(day: string, n: number): string {
	const d = new Date(`${day}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

type Gesture = { k: 'tap' | 'hold' | 'release'; task: string } | { k: 'rest' } | { k: 'off' };

export type SeedOp = { kind: string; id: string; set: Record<string, unknown> };

/**
 * Writes records the way another signed-in device would: ops pushed to the server, which
 * every device then pulls. Lets a test start from weeks of history without tapping them in.
 */
export class Seed {
	readonly ops: SeedOp[] = [];
	#marks = 0;

	task(
		id: string,
		title: string,
		hue: number,
		extra: { deadline?: number; longRunning?: boolean; status?: string; createdAt?: number } = {}
	): this {
		this.ops.push({
			kind: 'task',
			id,
			set: {
				title,
				hue,
				note: null,
				deadline: extra.deadline ?? null,
				longRunning: extra.longRunning ?? false,
				status: extra.status ?? 'active',
				createdAt: extra.createdAt ?? at('2026-09-01', '09:00')
			}
		});
		return this;
	}

	plan(day: string, task: string, rank: string): this {
		this.ops.push({ kind: 'plan', id: `${day}:${task}`, set: { on: true, rank } });
		return this;
	}

	mark(when: number, gesture: Gesture, reason: string | null = null): this {
		this.ops.push({
			kind: 'mark',
			id: `seed_m${++this.#marks}`,
			set: { at: when, gesture, voided: false, reason }
		});
		return this;
	}

	checkIn(day: string, values: Record<string, unknown>): this {
		this.ops.push({ kind: 'checkin', id: day, set: values });
		return this;
	}

	settings(values: Record<string, unknown>): this {
		this.ops.push({ kind: 'settings', id: 'user', set: values });
		return this;
	}

	async push(request: APIRequestContext): Promise<void> {
		const login = await request.post('/api/login', { data: { password: PASSWORD } });
		if (!login.ok()) throw new Error(`seed login: ${login.status()}`);
		const wall = Date.now();
		const stamped = this.ops.map((op, i) => ({
			...op,
			hlc: wall.toString(36).padStart(9, '0') + i.toString(36).padStart(4, '0') + 'seeddevice'
		}));
		for (let i = 0; i < stamped.length; i += 500) {
			const res = await request.post('/api/sync', {
				data: { after: 0, ops: stamped.slice(i, i + 500) }
			});
			if (!res.ok()) throw new Error(`seed push: ${res.status()} ${await res.text()}`);
		}
	}
}

export const TASKS = [
	{ id: 'seed_report', title: 'quarterly report', hue: 32 },
	{ id: 'seed_inbox', title: 'inbox, the bearable parts', hue: 200 },
	{ id: 'seed_review', title: 'review pr #412', hue: 280 },
	{ id: 'seed_thesis', title: 'thesis · chapter 3', hue: 140 },
	{ id: 'seed_dentist', title: 'call the dentist', hue: 350 }
] as const;

const REASONS = ['done', 'blocked', 'urge', 'pulled', null, null] as const;

/**
 * `days` closed days of switching before `TODAY`, with check-ins on most of them and a few
 * days left empty, deterministic so screenshots compare across runs.
 */
export function history(days: number): Seed {
	const seed = new Seed();
	for (const t of TASKS) seed.task(t.id, t.title, t.hue, { longRunning: t.id === 'seed_thesis' });
	seed.task('seed_old', 'renew the passport', 60, { status: 'done' });
	seed.task('seed_gone', 'learn the banjo', 100, { status: 'archived' });
	let r = 7;
	const rand = (n: number) => {
		r = (r * 48271) % 2147483647;
		return r % n;
	};
	for (let back = days; back >= 1; back--) {
		const day = addDays(TODAY, -back);
		if (rand(9) === 0) continue;
		TASKS.slice(0, 4).forEach((t, i) => seed.plan(day, t.id, `a${i}`));
		let minute = 8 * 60 + rand(60);
		const switches = 4 + rand(14);
		for (let s = 0; s < switches && minute < 20 * 60; s++) {
			const hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
			const roll = rand(10);
			const task = TASKS[rand(TASKS.length)].id;
			if (roll === 0) seed.mark(at(day, hhmm), { k: 'rest' });
			else if (roll === 1) seed.mark(at(day, hhmm), { k: 'hold', task });
			else seed.mark(at(day, hhmm), { k: 'tap', task }, REASONS[rand(REASONS.length)]);
			minute += 10 + rand(70);
		}
		seed.mark(at(day, '21:30'), { k: 'off' });
		if (rand(4) !== 0) {
			seed.checkIn(day, {
				strain: 1 + rand(5),
				stress: 1 + rand(5),
				mood: 1 + rand(5),
				sleepQuality: 1 + rand(5),
				headache: rand(4),
				switchOff: 1 + rand(5)
			});
		}
	}
	return seed;
}

/** A busy morning and afternoon on `TODAY`, up to 15:30, with juggles, a rest, and reasons. */
export function busyToday(seed: Seed): Seed {
	seed.task('seed_report', 'quarterly report', 32, { deadline: at(TODAY, '17:52') });
	seed.task('seed_groceries', 'groceries for the week', 90);
	const board = [
		'seed_report',
		'seed_inbox',
		'seed_review',
		'seed_thesis',
		'seed_dentist',
		'seed_groceries'
	];
	board.forEach((t, i) => seed.plan(TODAY, t, `a${i}`));
	const day: [string, Gesture, string | null][] = [
		['08:14', { k: 'tap', task: 'seed_inbox' }, null],
		['08:40', { k: 'tap', task: 'seed_report' }, 'pulled'],
		['09:05', { k: 'tap', task: 'seed_review' }, 'done'],
		['09:20', { k: 'hold', task: 'seed_report' }, null],
		['09:45', { k: 'tap', task: 'seed_inbox' }, 'urge'],
		['10:10', { k: 'tap', task: 'seed_thesis' }, null],
		['10:50', { k: 'tap', task: 'seed_report' }, 'blocked'],
		['11:20', { k: 'tap', task: 'seed_dentist' }, 'pulled'],
		['12:10', { k: 'rest' }, null],
		['12:55', { k: 'tap', task: 'seed_report' }, null],
		['13:30', { k: 'tap', task: 'seed_review' }, 'urge'],
		['13:50', { k: 'tap', task: 'seed_groceries' }, null],
		['14:05', { k: 'tap', task: 'seed_thesis' }, 'done'],
		['14:30', { k: 'hold', task: 'seed_inbox' }, null],
		['14:55', { k: 'tap', task: 'seed_report' }, 'pulled'],
		['15:18', { k: 'tap', task: 'seed_review' }, null],
		['15:30', { k: 'hold', task: 'seed_report' }, 'pulled']
	];
	for (const [hhmm, g, why] of day) seed.mark(at(TODAY, hhmm), g, why);
	seed.checkIn(addDays(TODAY, -1), {
		strain: 4,
		stress: 3,
		mood: 2,
		sleepHours: 6.5,
		note: 'long day'
	});
	return seed;
}
