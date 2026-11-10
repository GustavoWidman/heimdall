import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Instant, MarkId, TaskId } from '../domain/model';
import { parseEntity, parseOp, type Change } from './op';
import { Replica } from './replica.svelte';
import { Sync, type SyncStatus } from './sync';

/** A model of the server side of contract/sync.json: an append-only op log keyed by HLC. */
class FakeServer {
	epoch = 'epoch-1';
	rows: { seq: number; hlc: string; body: string }[] = [];
	nextSeq = 1;
	pageSize = 1000;
	authed = true;
	loseNextResponse = false;
	requests: { after: number; ops: { hlc: string }[] }[] = [];

	fetch: typeof fetch = async (input, init) => {
		const path = new URL(String(input), 'http://heimdall.test').pathname;
		const body = JSON.parse(String(init?.body ?? 'null'));
		if (path === '/api/login') {
			this.authed = body.password === 'hunter2';
			return new Response(null, { status: this.authed ? 204 : 401 });
		}
		if (path !== '/api/sync') return new Response(null, { status: 404 });
		if (!this.authed) return new Response(null, { status: 401 });
		this.requests.push(body);
		const bad = (body.ops as unknown[]).findIndex((op) => parseOp(op) === null);
		if (bad >= 0) return Response.json({ error: 'invalid op', index: bad }, { status: 400 });
		for (const op of body.ops) {
			if (!this.rows.some((r) => r.hlc === op.hlc)) {
				this.rows.push({ seq: this.nextSeq++, hlc: op.hlc, body: JSON.stringify(op) });
			}
		}
		const after = this.rows.filter((r) => r.seq > body.after);
		const page = after.slice(0, this.pageSize);
		const response = {
			epoch: this.epoch,
			head: this.rows.at(-1)?.seq ?? 0,
			ops: page.map((r) => ({ seq: r.seq, op: JSON.parse(r.body) })),
			more: after.length > page.length
		};
		if (this.loseNextResponse) {
			this.loseNextResponse = false;
			throw new TypeError('network connection lost');
		}
		return Response.json(response);
	};

	/** The server came back from an older backup: a new epoch and only the first `keep` ops. */
	restore(keep: number) {
		this.epoch = `epoch-${Math.random()}`;
		this.rows = this.rows.slice(0, keep);
		this.nextSeq = (this.rows.at(-1)?.seq ?? 0) + 1;
	}

	hlcs() {
		return this.rows.map((r) => r.hlc);
	}
}

let n = 0;
async function device(server: FakeServer) {
	const replica = await Replica.open({ name: `sync-${++n}-${Math.random()}` });
	await replica.loadAll('mark');
	const statuses: SyncStatus[] = [];
	const retries: (() => void)[] = [];
	const sync = new Sync(replica, {
		fetch: server.fetch,
		random: () => 0.5,
		schedule: (run) => {
			retries.push(run);
			return () => {};
		},
		onStatus: (s) => statuses.push(s)
	});
	return { replica, sync, statuses, retries };
}

const tap = (id: string, task: string, at: number): Change => ({
	kind: 'mark',
	id: id as MarkId,
	set: {
		at: at as Instant,
		gesture: { k: 'tap', task: task as TaskId },
		voided: false,
		reason: null
	}
});

const markIds = (r: Replica) =>
	[...r.mirror.mark.values()].map((rec) => parseEntity('mark', rec)?.id).sort();

describe('the sync loop', () => {
	it('pushes and pulls in one request', async () => {
		const server = new FakeServer();
		const phone = await device(server);
		phone.replica.commit([tap('m_phone', 't_a', 1000)]);
		await phone.replica.flushed();
		await phone.sync.wake();

		const desk = await device(server);
		desk.replica.commit([tap('m_desk', 't_b', 2000)]);
		await desk.replica.flushed();
		server.requests = [];
		await desk.sync.wake();

		expect(server.requests).toHaveLength(1);
		expect(server.requests[0].after).toBe(0);
		expect(server.requests[0].ops).toHaveLength(1);
		expect(markIds(desk.replica)).toEqual(['m_desk', 'm_phone']);
		expect(await desk.replica.pending(10)).toEqual([]);
		expect(desk.replica.cursor).toEqual({ epoch: 'epoch-1', seq: 2 });
		expect(desk.sync.status.kind).toBe('idle');
	});

	it('pages while the server says there is more', async () => {
		const server = new FakeServer();
		const phone = await device(server);
		phone.replica.commit(Array.from({ length: 7 }, (_, i) => tap(`m_${i}`, 't_a', 1000 + i)));
		await phone.replica.flushed();
		await phone.sync.wake();

		server.pageSize = 3;
		server.requests = [];
		const desk = await device(server);
		await desk.sync.wake();
		expect(server.requests.map((r) => r.after)).toEqual([0, 3, 6]);
		expect(markIds(desk.replica)).toHaveLength(7);
		expect(desk.replica.cursor.seq).toBe(7);
	});

	it('retries after a lost response without duplicating ops', async () => {
		const server = new FakeServer();
		const phone = await device(server);
		phone.replica.commit([tap('m_1', 't_a', 1000), tap('m_2', 't_b', 2000)]);
		await phone.replica.flushed();
		server.loseNextResponse = true;
		await phone.sync.wake();
		expect(phone.sync.status.kind).toBe('offline');
		expect(server.rows).toHaveLength(2);
		expect(await phone.replica.pending(10)).toHaveLength(2);

		expect(phone.retries).toHaveLength(1);
		await phone.sync.wake();
		expect(server.requests).toHaveLength(2);
		expect(server.requests[1].ops.map((o) => o.hlc)).toEqual(
			server.requests[0].ops.map((o) => o.hlc)
		);
		expect(server.rows).toHaveLength(2);
		expect(await phone.replica.pending(10)).toEqual([]);
		expect(phone.sync.status.kind).toBe('idle');
	});

	it('backs off with growing delays while the network is down', async () => {
		const server = new FakeServer();
		const phone = await device(server);
		const down = new Sync(phone.replica, {
			fetch: () => Promise.reject(new TypeError('offline')),
			now: () => 0,
			random: () => 1,
			schedule: () => () => {},
			onStatus: (s) => phone.statuses.push(s)
		});
		for (let i = 0; i < 8; i++) await down.wake();
		const delays = phone.statuses.flatMap((s) => (s.kind === 'offline' ? [s.retryAt] : []));
		expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
	});

	it('reseeds a server whose epoch changed', async () => {
		const server = new FakeServer();
		const phone = await device(server);
		phone.replica.commit([tap('m_1', 't_a', 1000)]);
		phone.replica.commit([{ kind: 'mark', id: 'm_1' as MarkId, set: { reason: 'urge' } }]);
		await phone.replica.flushed();
		await phone.sync.wake();
		const before = server.hlcs().sort();
		expect(before).toHaveLength(2);

		server.restore(0);
		phone.replica.commit([tap('m_2', 't_b', 3000)]);
		await phone.replica.flushed();
		await phone.sync.wake();

		expect(phone.replica.cursor.epoch).toBe(server.epoch);
		expect(server.hlcs()).toHaveLength(3);
		expect(server.hlcs()).toEqual(expect.arrayContaining(before));
		expect(await phone.replica.pending(10)).toEqual([]);
		expect(phone.replica.cursor.seq).toBe(3);
	});

	it('waits for login on 401 while local commits keep working', async () => {
		const server = new FakeServer();
		server.authed = false;
		const phone = await device(server);
		phone.replica.commit([tap('m_1', 't_a', 1000)]);
		await phone.replica.flushed();
		await phone.sync.wake();
		expect(phone.sync.status).toEqual({ kind: 'needs-login' });

		phone.replica.commit([tap('m_2', 't_b', 2000)]);
		expect(markIds(phone.replica)).toEqual(['m_1', 'm_2']);
		await phone.replica.flushed();
		await phone.sync.wake();
		expect(server.requests).toHaveLength(0);

		expect(await phone.sync.login('wrong')).toBe(false);
		expect(await phone.sync.login('hunter2')).toBe(true);
		await phone.sync.wake();
		expect(server.rows).toHaveLength(2);
		expect(phone.sync.status.kind).toBe('idle');
	});

	it('syncs when the live stream reports a newer head', async () => {
		const server = new FakeServer();
		let onHead: ((e: MessageEvent<string>) => void) | null = null;
		const replica = await Replica.open({ name: `sync-live-${Math.random()}` });
		await replica.loadAll('mark');
		const sync = new Sync(replica, {
			fetch: server.fetch,
			live: () => ({ addEventListener: (_t, l) => (onHead = l), close: () => {} })
		});
		await sync.wake();
		expect(onHead).not.toBeNull();

		const phone = await device(server);
		phone.replica.commit([tap('m_live', 't_a', 1000)]);
		await phone.replica.flushed();
		await phone.sync.wake();

		onHead!(new MessageEvent('head', { data: JSON.stringify({ head: 1 }) }));
		await sync.wake();
		expect(markIds(replica)).toEqual(['m_live']);
	});
});
