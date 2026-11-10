import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { carryIn, deriveDay, type DayView } from '../domain/focus';
import type { Instant, Mark } from '../domain/model';
import { rangeOf } from '../domain/time';
import { day, marks as notebookMarks, settings } from '../domain/notebook-day.fixture';
import { Clock, parseEntity, parseOp, stamp, type Change, type Op } from './op';
import { Replica } from './replica.svelte';

let n = 0;
const fresh = () => `test-${++n}-${Math.random()}`;
const range = rangeOf(day, settings);

async function openDay(name: string, extra: Parameters<typeof Replica.open>[0] = {}) {
	const r = await Replica.open({ name, ...extra });
	await r.loadIndex('mark', range.start - 24 * 3_600_000, range.end);
	return r;
}

function marksOf(r: Replica): Mark[] {
	return [...r.mirror.mark.values()]
		.map((rec) => parseEntity('mark', rec))
		.filter((m) => m !== null);
}

function viewOf(r: Replica): DayView {
	const ms = marksOf(r);
	return deriveDay(ms, range, carryIn(ms, range.start), false);
}

const markChange = (m: Mark): Change => ({
	kind: 'mark',
	id: m.id,
	set: { at: m.at, gesture: m.gesture, voided: m.voided, reason: m.reason }
});

describe('commit', () => {
	it('updates the mirror before anything is awaited, then persists', async () => {
		const name = fresh();
		const r = await openDay(name);
		r.commit([markChange(notebookMarks[0])]);
		expect(marksOf(r)).toEqual([notebookMarks[0]]);
		await r.flushed();
		r.close();

		const again = await openDay(name);
		expect(marksOf(again)).toEqual([notebookMarks[0]]);
		expect(await again.pending(10)).toHaveLength(1);
	});

	it('drops a mark retimed out of the loaded days from the mirror, and back', async () => {
		const r = await openDay(fresh());
		const m = notebookMarks[1];
		r.commit([markChange(m)]);
		r.commit([{ kind: 'mark', id: m.id, set: { at: (range.end + 3_600_000) as Instant } }]);
		expect(marksOf(r)).toEqual([]);
		r.commit([{ kind: 'mark', id: m.id, set: { at: m.at } }]);
		await r.flushed();
		expect(marksOf(r)).toEqual([m]);
	});

	it('deletes the cached aggregates a change makes stale', async () => {
		const r = await openDay(fresh(), {
			invalidate: (t) => (t.kind === 'mark' ? ['2026-11-09'] : [])
		});
		await r.store.putAggregates([{ day: '2026-11-09' }, { day: '2026-11-08' }]);
		r.commit([markChange(notebookMarks[0])]);
		await r.flushed();
		expect(await r.store.aggregates(['2026-11-09', '2026-11-08'])).toEqual([
			undefined,
			{ day: '2026-11-08' }
		]);
	});
});

function opsFor(marks: readonly Mark[]): Op[] {
	const phone = new Clock('pppppppppp');
	const desk = new Clock('dddddddddd');
	const ops: Op[] = [];
	marks.forEach((m, i) => {
		const clock = i % 2 ? phone : desk;
		ops.push(stamp(markChange(m), clock.tick(m.at)));
		if (i % 5 === 0)
			ops.push(stamp({ kind: 'mark', id: m.id, set: { reason: 'urge' } }, clock.tick(m.at + 1)));
		if (i % 7 === 3)
			ops.push(stamp({ kind: 'mark', id: m.id, set: { voided: true } }, clock.tick(m.at + 2)));
		if (i % 9 === 4) {
			const other = i % 2 ? desk : phone;
			ops.push(
				stamp(
					{ kind: 'mark', id: m.id, set: { at: (m.at - 600_000) as Instant } },
					other.tick(m.at + 3)
				)
			);
		}
	});
	return ops;
}

describe('absorb', () => {
	const ops = opsFor(notebookMarks);

	it('renders the same day on two replicas that absorb the same ops in different orders', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.shuffledSubarray(ops, { minLength: ops.length }),
				fc.integer({ min: 1, max: 12 }),
				async (shuffled, batch) => {
					const a = await openDay(fresh());
					const b = await openDay(fresh());
					await a.absorb({ ops, acked: [], cursor: ops.length, epoch: 'e' });
					for (let i = 0; i < shuffled.length; i += batch) {
						await b.absorb({ ops: shuffled.slice(i, i + batch), acked: [], cursor: i, epoch: 'e' });
					}
					await b.absorb({
						ops: shuffled.slice(0, batch),
						acked: [],
						cursor: ops.length,
						epoch: 'e'
					});
					expect(viewOf(a).switches).toBeGreaterThan(5);
					expect(viewOf(b)).toEqual(viewOf(a));
					a.close();
					b.close();
				}
			),
			{ numRuns: 25 }
		);
	});

	it('acknowledges pushed ops and treats their echo as already seen', async () => {
		const r = await openDay(fresh());
		const [op] = r.commit([markChange(notebookMarks[0])]);
		await r.flushed();
		const before = r.mirror.mark.get(op.id);
		await r.absorb({ ops: [op], acked: [op.hlc], cursor: 1, epoch: 'e1' });
		expect(r.mirror.mark.get(op.id)).toBe(before);
		expect(await r.pending(10)).toEqual([]);
		expect(r.cursor).toEqual({ epoch: 'e1', seq: 1 });
	});

	it('keeps ops of unknown kinds aside and sends them again on a reseed', async () => {
		const r = await openDay(fresh());
		const alien = parseOp({
			hlc: '0000lkx9e0000f9e8d7c6b5',
			kind: 'a_kind_from_a_newer_build',
			id: 'x',
			set: { anything: true }
		}) as Op;
		const [mine] = r.commit([markChange(notebookMarks[0])]);
		await r.flushed();
		await r.absorb({ ops: [alien], acked: [mine.hlc], cursor: 7, epoch: 'old' });
		expect(await r.pending(10)).toEqual([]);
		await r.reseed('new');
		expect(r.cursor).toEqual({ epoch: 'new', seq: 0 });
		expect((await r.pending(10)).map((o) => o.hlc).sort()).toEqual([alien.hlc, mine.hlc].sort());
	});
});

describe('tabs on one device', () => {
	it('show each other’s commits through the broadcast channel', async () => {
		const name = fresh();
		const one = await openDay(name, { channel: new BroadcastChannel(name) });
		const two = await openDay(name, { channel: new BroadcastChannel(name) });
		const heard = new Promise<void>((resolve) => two.onChange(resolve));
		one.commit([markChange(notebookMarks[0])]);
		await heard;
		expect(marksOf(two)).toEqual([notebookMarks[0]]);
		one.close();
		two.close();
	});
});
