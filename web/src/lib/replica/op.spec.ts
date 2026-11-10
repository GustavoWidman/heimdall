import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	Clock,
	join,
	merge,
	opsFromRecord,
	parseEntity,
	parseOp,
	stamp,
	type Hlc,
	type Op,
	type Rec
} from './op';
import type { Instant, MarkId, TaskId } from '../domain/model';

const fixture = JSON.parse(
	readFileSync(new URL('../../../../contract/sync.json', import.meta.url), 'utf8')
) as {
	valid_ops: unknown[];
	invalid_ops: { why: string; op: unknown }[];
	limits: { max_op_bytes: number };
};

describe('the wire contract in contract/sync.json', () => {
	it.each(fixture.valid_ops.map((op) => [JSON.stringify(op).slice(0, 60), op]))(
		'accepts %s',
		(_name, op) => {
			expect(parseOp(op)).toEqual(op);
		}
	);

	it.each(fixture.invalid_ops.map(({ why, op }) => [why, op]))(
		'rejects an op whose %s',
		(_why, op) => {
			expect(parseOp(op)).toBeNull();
		}
	);

	it('rejects an op larger than the byte limit', () => {
		const op = {
			hlc: '0000lkx9a0001a1b2c3d4e5',
			kind: 'checkin',
			id: '2026-11-10',
			set: { note: '' }
		};
		const room = fixture.limits.max_op_bytes - JSON.stringify(op).length;
		expect(parseOp({ ...op, set: { note: 'x'.repeat(room) } })).not.toBeNull();
		expect(parseOp({ ...op, set: { note: 'x'.repeat(room + 1) } })).toBeNull();
	});

	it('keeps fields from a newer build through merge and re-seeding', () => {
		const op = parseOp(fixture.valid_ops[4]) as Op;
		const rec = merge(undefined, op);
		expect(opsFromRecord(op.kind, rec)).toEqual([op]);
		expect(parseEntity('checkin', rec)?.values).toEqual({ strain: 4, headache: 1 });
	});
});

const hlc = (wall: number, counter: number, replica: string) =>
	(wall.toString(36).padStart(9, '0') + counter.toString(36).padStart(4, '0') + replica) as Hlc;

const arbOps = fc
	.uniqueArray(
		fc.record({
			wall: fc.integer({ min: 0, max: 50 }),
			counter: fc.integer({ min: 0, max: 3 }),
			replica: fc.constantFrom('aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc')
		}),
		{ selector: (c) => hlc(c.wall, c.counter, c.replica), maxLength: 40 }
	)
	.chain((clocks) =>
		fc.tuple(
			...clocks.map((c) =>
				fc.record({
					hlc: fc.constant(hlc(c.wall, c.counter, c.replica)),
					kind: fc.constant('task'),
					id: fc.constantFrom('t_1', 't_2'),
					set: fc.dictionary(fc.constantFrom('title', 'hue', 'note', 'later'), fc.jsonValue(), {
						minKeys: 1,
						maxKeys: 3
					})
				})
			)
		)
	);

function fold(ops: readonly Op[]): Map<string, Rec> {
	const recs = new Map<string, Rec>();
	for (const op of ops) recs.set(op.id, merge(recs.get(op.id), op));
	return recs;
}

function joinAll(a: Map<string, Rec>, b: Map<string, Rec>): Map<string, Rec> {
	const out = new Map(a);
	for (const [id, rec] of b) out.set(id, join(out.get(id), rec));
	return out;
}

describe('merge', () => {
	it('ends in the same records whatever the order of the ops', () => {
		fc.assert(
			fc.property(
				arbOps.chain((ops) =>
					fc.tuple(fc.constant(ops), fc.shuffledSubarray(ops, { minLength: ops.length }))
				),
				([ops, shuffled]) => {
					expect(fold(shuffled)).toEqual(fold(ops));
				}
			),
			{ numRuns: 500 }
		);
	});

	it('ignores ops it has already seen', () => {
		fc.assert(
			fc.property(arbOps, (ops) => {
				const once = fold(ops);
				const twice = fold([...ops, ...ops]);
				expect(twice).toEqual(once);
				for (const op of ops) expect(merge(once.get(op.id), op)).toBe(once.get(op.id));
			}),
			{ numRuns: 300 }
		);
	});

	it('joins partial states the same way however they are grouped', () => {
		fc.assert(
			fc.property(
				arbOps.chain((ops) =>
					fc.tuple(
						fc.constant(ops),
						fc.array(fc.integer({ min: 0, max: 2 }), {
							minLength: ops.length,
							maxLength: ops.length
						})
					)
				),
				([ops, groups]) => {
					const [a, b, c] = [0, 1, 2].map((g) => fold(ops.filter((_, i) => groups[i] === g)));
					expect(joinAll(joinAll(a, b), c)).toEqual(joinAll(a, joinAll(b, c)));
					expect(joinAll(joinAll(a, b), c)).toEqual(fold(ops));
					expect(joinAll(b, a)).toEqual(joinAll(a, b));
				}
			),
			{ numRuns: 300 }
		);
	});

	it('rebuilds the same record from opsFromRecord', () => {
		fc.assert(
			fc.property(arbOps, (ops) => {
				for (const rec of fold(ops).values()) {
					expect(fold(opsFromRecord('task', rec)).get(rec.id)).toEqual(rec);
				}
			}),
			{ numRuns: 300 }
		);
	});

	it('keeps the later write of each field, so a rename and a deadline edit both survive', () => {
		const rename = {
			hlc: hlc(10, 0, 'aaaaaaaaaa'),
			kind: 'task',
			id: 't_1',
			set: { title: 'new' }
		};
		const deadline = {
			hlc: hlc(9, 0, 'bbbbbbbbbb'),
			kind: 'task',
			id: 't_1',
			set: { deadline: 5, title: 'old' }
		};
		const rec = merge(merge(undefined, rename), deadline);
		expect(rec.regs.title.v).toBe('new');
		expect(rec.regs.deadline.v).toBe(5);
	});
});

describe('Clock', () => {
	it('stamps strictly increasing values even when the wall clock goes back', () => {
		const clock = new Clock('aaaaaaaaaa');
		const stamps = [
			clock.tick(1000),
			clock.tick(1000),
			clock.tick(999),
			clock.tick(1001),
			clock.tick(5)
		];
		expect([...stamps].sort()).toEqual(stamps);
		expect(new Set(stamps).size).toBe(stamps.length);
		expect(stamps.every((s) => s.length === 23)).toBe(true);
	});

	it('moves past a clock it has seen from another replica', () => {
		const clock = new Clock('aaaaaaaaaa');
		const ahead = new Clock('zzzzzzzzzz').tick(1_000_000);
		clock.observe(ahead);
		expect(clock.tick(10) > ahead).toBe(true);
	});

	it('continues after the floor it was opened with', () => {
		const floor = new Clock('bbbbbbbbbb').tick(Date.UTC(2026, 10, 10));
		expect(new Clock('aaaaaaaaaa', floor).tick(0) > floor).toBe(true);
	});
});

describe('parseEntity', () => {
	it('reads a mark with defaults for fields never written', () => {
		const op = stamp(
			{
				kind: 'mark',
				id: 'm_1' as MarkId,
				set: { at: 5 as Instant, gesture: { k: 'tap', task: 't_a' as TaskId } }
			},
			hlc(1, 0, 'aaaaaaaaaa')
		);
		expect(parseEntity('mark', merge(undefined, op))).toEqual({
			id: 'm_1',
			at: 5,
			gesture: { k: 'tap', task: 't_a' },
			voided: false,
			reason: null
		});
	});

	it('does not render a mark whose gesture this build cannot read', () => {
		const op = {
			hlc: hlc(1, 0, 'aaaaaaaaaa'),
			kind: 'mark',
			id: 'm_1',
			set: { at: 5, gesture: { k: 'snooze' } }
		};
		expect(parseEntity('mark', merge(undefined, op))).toBeNull();
	});
});
