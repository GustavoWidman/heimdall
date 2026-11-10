import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { DayKey, Instant, MarkId, TaskId } from '../domain/model';
import { App } from './app.svelte';

const at = (iso: string) => Date.parse(`${iso}-03:00`);
let clock = at('2026-11-10T09:00:00');
let ids = 0;
const opened: App[] = [];

async function open(
	fetch: typeof globalThis.fetch = async () => new Response(null, { status: 401 })
) {
	const app = await App.open({
		dbName: `app-${Math.random()}`,
		now: () => clock,
		deviceZone: 'America/Sao_Paulo',
		newId: () => String(++ids).padStart(6, '0'),
		channel: null,
		sync: { fetch },
		timers: { every: () => () => {}, yieldToMain: async () => {} }
	});
	opened.push(app);
	return app;
}

afterEach(() => {
	for (const app of opened.splice(0)) app.close();
	clock = at('2026-11-10T09:00:00');
});

function create(app: App, title: string): TaskId {
	const d = app.do({ k: 'createTask', title, planFor: app.today.day });
	if (!d.ok) throw new Error(d.rejection.problem);
	return d.changes[0].id as TaskId;
}

describe('the tap path', () => {
	it('updates today’s view, board, and switch count before anything is awaited', async () => {
		const app = await open();
		const report = create(app, 'report');
		const mail = create(app, 'mail');
		expect(app.today.day).toBe('2026-11-10');
		expect(app.today.board.map((r) => r.task.title)).toEqual(['report', 'mail']);

		app.do({ k: 'tap', task: report });
		clock = at('2026-11-10T09:20:00');
		app.do({ k: 'hold', task: mail });

		expect(app.today.view.switches).toBe(1);
		expect(app.today.board.map((r) => [r.task.title, r.day.ticks, r.inFocus])).toEqual([
			['report', 1, true],
			['mail', 1, true]
		]);
		expect(app.today.view.tail?.focus).toEqual({ k: 'working', tasks: [mail, report].sort() });
	});

	it('keeps working while the server asks for a login', async () => {
		const app = await open();
		await app.flushed();
		const a = create(app, 'a');
		app.do({ k: 'tap', task: a });
		await app.flushed();
		await new Promise((r) => setTimeout(r, 0));
		expect(app.sync).toEqual({ kind: 'needs-login' });
		expect(app.today.view.ticks).toBe(1);
	});

	it('reports a rejected intent without writing', async () => {
		const app = await open();
		expect(app.do({ k: 'createTask', title: '' })).toMatchObject({ ok: false });
		expect(app.tasks).toEqual([]);
	});
});

describe('history', () => {
	it('loads a past day on first read, then shows it ready', async () => {
		const app = await open();
		const a = create(app, 'a');
		app.do({ k: 'tap', task: a, at: at('2026-11-07T10:00:00') as Instant });
		const key = '2026-11-07' as DayKey;
		expect(app.day(key).status).toBe('loading');
		for (let i = 0; i < 50 && app.day(key).status === 'loading'; i++) {
			await new Promise((r) => setTimeout(r, 1));
		}
		const page = app.day(key);
		expect(page.status).toBe('ready');
		if (page.status === 'ready') expect(page.marks).toHaveLength(1);
	});

	it('aggregates a range, caches closed days, and recomputes a day after it is edited', async () => {
		const app = await open();
		const a = create(app, 'a');
		const b = create(app, 'b');
		app.do({ k: 'tap', task: a, at: at('2026-11-08T10:00:00') as Instant });
		const d = app.do({ k: 'tap', task: b, at: at('2026-11-08T11:00:00') as Instant });
		app.do({ k: 'off', at: at('2026-11-08T12:00:00') as Instant });
		app.do({ k: 'checkIn', day: '2026-11-08' as DayKey, patch: { strain: 4 } });
		await app.flushed();

		const first = await app.range('2026-11-07' as DayKey, '2026-11-10' as DayKey);
		expect(first.map((s) => [s.agg.day, s.agg.switches, s.agg.focusMs / 60_000])).toEqual([
			['2026-11-07', 0, 0],
			['2026-11-08', 1, 120],
			['2026-11-09', 0, 0],
			['2026-11-10', 0, 0]
		]);
		expect(first[1].checkIn).toEqual({ strain: 4 });
		expect(await app.range('2026-11-07' as DayKey, '2026-11-10' as DayKey)).toEqual(first);

		if (!d.ok) throw new Error('rejected');
		app.do({ k: 'void', mark: d.changes[0].id as MarkId, voided: true });
		await app.flushed();
		const after = await app.range('2026-11-08' as DayKey, '2026-11-08' as DayKey);
		expect(after[0].agg.switches).toBe(0);
		expect(after[0].agg.focusMs / 60_000).toBe(120);

		const i = await app.insights(7);
		expect(i.series.map((p) => p.day)).toEqual([
			'2026-11-04',
			'2026-11-05',
			'2026-11-06',
			'2026-11-07',
			'2026-11-08',
			'2026-11-09',
			'2026-11-10'
		]);
	});
});
