import { describe, expect, it } from 'vitest';
import { Clock, merge, parseEntity, stamp, type Change, type Kind, type Rec } from '../replica/op';
import { boardOrder } from './board';
import { decide, type DecideContext, type Intent } from './commands';
import { carryIn, deriveDay } from './focus';
import {
	parsePlanId,
	type DayKey,
	type Instant,
	type Mark,
	type MarkId,
	type TaskId
} from './model';
import { rangeOf } from './time';
import { local, settings } from './notebook-day.fixture';

const DAY = '2026-11-09' as DayKey;

/** A minimal in-memory replica: decide, stamp, merge, read back. */
function world(start: Instant) {
	const recs = new Map<string, Rec>();
	const clock = new Clock('aaaaaaaaaa');
	let now = start;
	let n = 0;
	const all = <K extends Kind>(kind: K) =>
		[...recs]
			.filter(([key]) => key.startsWith(`${kind}/`))
			.map(([, rec]) => parseEntity(kind, rec))
			.filter((e) => e !== null);
	const marks = () => all('mark') as Mark[];
	const view = () => {
		const range = rangeOf(DAY, settings);
		return deriveDay(marks(), range, carryIn(marks(), range.start), true);
	};
	const ctx = (): DecideContext => ({
		now,
		state: view().state,
		newId: () => String(++n).padStart(4, '0'),
		mark: (id) => marks().find((m) => m.id === id),
		task: (id) => all('task').find((t) => t.id === id),
		tasks: () => all('task'),
		plan: (day) => all('plan').filter((p) => p.day === day)
	});
	function apply(changes: readonly Change[]) {
		for (const c of changes) {
			const key = `${c.kind}/${c.id}`;
			recs.set(key, merge(recs.get(key), stamp(c, clock.tick(now))));
		}
	}
	return {
		do(intent: Intent) {
			const d = decide(ctx(), intent);
			if (d.ok) apply(d.changes);
			return d;
		},
		at(hhmm: string) {
			now = local(DAY, hhmm);
		},
		view,
		marks,
		tasks: () => all('task'),
		board: () => boardOrder(all('plan').filter((p) => p.day === DAY)).map((p) => p.task),
		checkIn: () => all('checkin').find((c) => c.day === DAY)?.values,
		settings: () => all('settings')[0]
	};
}

function created(w: ReturnType<typeof world>, title: string): TaskId {
	const d = w.do({ k: 'createTask', title });
	if (!d.ok) throw new Error(d.rejection.problem);
	return d.changes[0].id as TaskId;
}

describe('gestures', () => {
	it('records a tap now and ignores a repeat tap on the task already alone', () => {
		const w = world(local(DAY, '09:00'));
		const a = created(w, 'report');
		w.do({ k: 'tap', task: a });
		w.at('09:05');
		const again = w.do({ k: 'tap', task: a });
		expect(again).toEqual({ ok: true, changes: [] });
		expect(w.marks()).toHaveLength(1);
		expect(w.marks()[0]).toMatchObject({ at: local(DAY, '09:00'), gesture: { k: 'tap', task: a } });
	});

	it('backdates a forgotten switch, clamping a future time to now', () => {
		const w = world(local(DAY, '15:00'));
		const a = created(w, 'report');
		const b = created(w, 'mail');
		w.do({ k: 'tap', task: a, at: local(DAY, '13:00') });
		w.do({ k: 'tap', task: b, at: local(DAY, '14:00') });
		w.do({ k: 'rest', at: local(DAY, '18:00') });
		expect(w.view().switches).toBe(1);
		expect(
			w
				.marks()
				.map((m) => m.at)
				.sort()
		).toEqual([local(DAY, '13:00'), local(DAY, '14:00'), local(DAY, '15:00')]);
	});

	it('tags, retimes, and voids by writing one field of the mark', () => {
		const w = world(local(DAY, '09:00'));
		const a = created(w, 'report');
		const b = created(w, 'mail');
		w.do({ k: 'tap', task: a });
		w.at('10:00');
		const d = w.do({ k: 'tap', task: b });
		const id = (d.ok && d.changes[0].id) as MarkId;
		w.at('10:00');
		w.do({ k: 'tag', mark: id, reason: 'pulled' });
		expect(w.view().lastSwitch?.reason).toBe('pulled');
		w.do({ k: 'retime', mark: id, at: local(DAY, '09:30') });
		expect(w.view().perTask.get(a)?.ms).toBe(30 * 60_000);
		w.do({ k: 'void', mark: id, voided: true });
		expect(w.view().switches).toBe(0);
		expect(w.do({ k: 'tag', mark: 'm_nope' as MarkId, reason: null })).toMatchObject({ ok: false });
	});

	it('rejects a gesture on a task that does not exist', () => {
		const w = world(local(DAY, '09:00'));
		expect(w.do({ k: 'tap', task: 't_ghost' as TaskId })).toEqual({
			ok: false,
			rejection: { field: 'task', problem: 'unknown task' }
		});
	});
});

describe('tasks', () => {
	it('creates a task with a trimmed title, and plans it in the same step', () => {
		const w = world(local(DAY, '09:00'));
		const d = w.do({ k: 'createTask', title: '  quarterly report ', planFor: DAY });
		expect(d.ok).toBe(true);
		expect(w.tasks()[0]).toMatchObject({ title: 'quarterly report', status: 'active', note: null });
		expect(w.board()).toEqual([w.tasks()[0].id]);
	});

	it('rejects an empty title and an out-of-range hue', () => {
		const w = world(local(DAY, '09:00'));
		expect(w.do({ k: 'createTask', title: '   ' })).toMatchObject({
			ok: false,
			rejection: { field: 'title' }
		});
		expect(w.do({ k: 'createTask', title: 'x', hue: 360 })).toMatchObject({
			ok: false,
			rejection: { field: 'hue' }
		});
		expect(w.tasks()).toEqual([]);
	});

	it('gives consecutive tasks hues a golden angle apart', () => {
		const w = world(local(DAY, '09:00'));
		created(w, 'one');
		w.at('09:01');
		created(w, 'two');
		const [first, second] = w.tasks().sort((x, y) => x.createdAt - y.createdAt);
		expect((second.hue - first.hue + 360) % 360).toBe(138);
	});

	it('writes only the fields an edit names', () => {
		const w = world(local(DAY, '09:00'));
		const a = created(w, 'report');
		w.do({ k: 'editTask', task: a, deadline: local(DAY, '18:00') });
		w.do({ k: 'editTask', task: a, title: 'final report', status: 'done' });
		expect(w.tasks()[0]).toMatchObject({
			title: 'final report',
			deadline: local(DAY, '18:00'),
			status: 'done'
		});
	});
});

describe('the board plan', () => {
	it('appends, reorders, and removes planned tasks', () => {
		const w = world(local(DAY, '08:00'));
		const [a, b, c] = ['a', 'b', 'c'].map((t) => created(w, t));
		for (const t of [a, b, c]) w.do({ k: 'plan', day: DAY, task: t });
		expect(w.board()).toEqual([a, b, c]);
		w.do({ k: 'reorder', day: DAY, task: c, before: a });
		expect(w.board()).toEqual([c, a, b]);
		w.do({ k: 'reorder', day: DAY, task: c, before: null });
		expect(w.board()).toEqual([a, b, c]);
		w.do({ k: 'reorder', day: DAY, task: a, before: c });
		expect(w.board()).toEqual([b, a, c]);
		w.do({ k: 'unplan', day: DAY, task: a });
		expect(w.board()).toEqual([b, c]);
		expect(w.do({ k: 'plan', day: DAY, task: b })).toEqual({ ok: true, changes: [] });
	});

	it('renumbers the day when two entries share a rank', () => {
		const ctx = (entries: [string, string][]): DecideContext => ({
			now: 0 as Instant,
			state: { focus: { k: 'off' }, held: null },
			newId: () => 'x',
			mark: () => undefined,
			task: () => undefined,
			tasks: () => [],
			plan: () =>
				entries.map(([task, rank]) => ({ day: DAY, task: task as TaskId, on: true, rank }))
		});
		const d = decide(
			ctx([
				['t_a', 'h'],
				['t_b', 'h'],
				['t_c', 'p']
			]),
			{
				k: 'reorder',
				day: DAY,
				task: 't_c' as TaskId,
				before: 't_b' as TaskId
			}
		);
		if (!d.ok) throw new Error('rejected');
		const ranks = d.changes.map((c) => [parsePlanId(c.id)?.task, (c.set as { rank: string }).rank]);
		expect(ranks.map(([t]) => t)).toEqual(['t_a', 't_c', 't_b']);
		expect(ranks.map(([, r]) => r)).toEqual([...ranks.map(([, r]) => r)].sort());
	});
});

describe('check-in and settings', () => {
	it('patches check-in fields and clears with null', () => {
		const w = world(local(DAY, '22:00'));
		w.do({ k: 'checkIn', day: DAY, patch: { strain: 4, headache: 2, note: 'long day' } });
		w.do({ k: 'checkIn', day: DAY, patch: { headache: null } });
		expect(w.checkIn()).toEqual({ strain: 4, note: 'long day' });
	});

	it('rejects unknown fields and out-of-range values', () => {
		const w = world(local(DAY, '22:00'));
		expect(w.do({ k: 'checkIn', day: DAY, patch: { strain: 6 } })).toMatchObject({
			ok: false,
			rejection: { field: 'strain' }
		});
		expect(w.do({ k: 'checkIn', day: DAY, patch: { mystery: 1 } })).toMatchObject({ ok: false });
	});

	it('validates the zone and the day-start hour', () => {
		const w = world(local(DAY, '22:00'));
		expect(w.do({ k: 'settings', timeZone: 'Mars/Olympus' })).toMatchObject({ ok: false });
		expect(w.do({ k: 'settings', dayStartHour: 24 })).toMatchObject({ ok: false });
		w.do({ k: 'settings', timeZone: 'Europe/Berlin', dayStartHour: 5 });
		expect(w.settings()).toEqual({ timeZone: 'Europe/Berlin', dayStartHour: 5 });
	});

	it('takes the bounce window in whole minutes up to an hour', () => {
		const w = world(local(DAY, '22:00'));
		expect(w.do({ k: 'settings', bounceMinutes: 2.5 })).toMatchObject({ ok: false });
		expect(w.do({ k: 'settings', bounceMinutes: 61 })).toMatchObject({ ok: false });
		w.do({ k: 'settings', bounceMinutes: 0 });
		expect(w.settings()).toEqual({ bounceMinutes: 0 });
	});
});
