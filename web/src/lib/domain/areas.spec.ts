import { describe, expect, it } from 'vitest';
import { areaBreakdown, areasOf, classify, hardOf, splitSwitches, type Areas } from './areas';
import { carryIn, deriveDay } from './focus';
import {
	area,
	type DayKey,
	type Gesture,
	type Instant,
	type Mark,
	type MarkId,
	type Task,
	type TaskId,
	type TaskSet,
	type TaskStatus,
	type Title
} from './model';
import { aggregateDay } from './stats';
import { rangeOf } from './time';
import * as notebook from './notebook-day.fixture';

const MIN = 60_000;
const SEC = 1000;
const a = 't_a' as TaskId;
const b = 't_b' as TaskId;
const c = 't_c' as TaskId;
const d = 't_d' as TaskId;
const u = 't_u' as TaskId;

const tap = (task: TaskId): Gesture => ({ k: 'tap', task });
const hold = (task: TaskId): Gesture => ({ k: 'hold', task });
const release = (task: TaskId): Gesture => ({ k: 'release', task });
const rest: Gesture = { k: 'rest' };
const off: Gesture = { k: 'off' };

function task(id: TaskId, tag: string | null, status: TaskStatus = 'active'): Task {
	return {
		id,
		title: id as string as Title,
		note: null,
		hue: 0 as never,
		deadline: null,
		longRunning: false,
		status,
		createdAt: 0 as Instant,
		area: area(tag)
	};
}

const areas = areasOf([
	task(a, 'Work '),
	task(b, 'work'),
	task(c, 'COLLEGE'),
	task(d, 'college'),
	task(u, null)
]);

let seq = 0;
function marksOf(gestures: readonly Gesture[], spacingMin = 10): Mark[] {
	const start = notebook.local(notebook.day, '09:00');
	return gestures.map((gesture, i) => ({
		id: `m_${String(++seq).padStart(4, '0')}` as MarkId,
		at: (start + i * spacingMin * MIN) as Instant,
		gesture,
		voided: false,
		reason: null
	}));
}

function viewOf(marks: readonly Mark[], bounceMin = 0, day: DayKey = notebook.day) {
	const range = rangeOf(day, notebook.settings);
	const bounce = bounceMin * MIN;
	return deriveDay(marks, range, carryIn(marks, range.start, bounce), false, bounce);
}

const day = (...gestures: Gesture[]) => viewOf(marksOf(gestures));
const split = (hard: number, soft: number, unsorted: number) => ({
	hard,
	soft,
	unsorted,
	total: hard + soft + unsorted
});

const cases: [string, Gesture[], ReturnType<typeof split>][] = [
	['across and within', [tap(a), tap(b), tap(c), tap(a)], split(2, 1, 0)],
	['a juggle', [tap(a), hold(c), tap(d), hold(b), tap(a)], split(2, 2, 0)],
	['narrowing is no switch', [tap(a), hold(c), tap(c), tap(b)], split(2, 0, 0)],
	['rest', [tap(a), rest, tap(c), rest, tap(c), rest, tap(b), rest, tap(a)], split(2, 1, 0)],
	['rest after a juggle', [tap(a), hold(c), rest, tap(d)], split(1, 1, 0)],
	['release into rest', [tap(a), release(a), tap(c)], split(1, 0, 0)],
	['off forgets', [tap(a), off, tap(c)], split(0, 0, 0)],
	[
		'an untagged task involved',
		[tap(a), tap(u), tap(c), hold(u), tap(d), tap(a), hold(u), tap(c)],
		split(1, 1, 5)
	]
];

describe('classifying switches', () => {
	it.each(cases)('%s', (_name, gestures, expected) => {
		expect(splitSwitches(day(...gestures).switchLog, areas)).toEqual(expected);
	});

	it('calls a switch soft when its tag is held, even beside an untagged task', () => {
		const v = day(tap(c), hold(u), tap(d));
		expect(v.switchLog.map((s) => classify(s, areas))).toEqual(['unsorted', 'soft']);
	});

	it('calls it soft wherever the untagged task sits in the held set', () => {
		for (const from of [
			[u, c],
			[c, u]
		] as unknown as TaskSet[]) {
			expect(classify({ into: d, from }, areas)).toBe('soft');
		}
	});

	it('reads the set held before the day start, working or resting', () => {
		const next = '2026-11-10' as DayKey;
		const at = (date: string, hhmm: string) => notebook.local(date, hhmm);
		const mk = (when: Instant, gesture: Gesture): Mark => ({
			id: `m_${String(++seq).padStart(4, '0')}` as MarkId,
			at: when,
			gesture,
			voided: false,
			reason: null
		});
		const working = [mk(at(notebook.day, '23:00'), tap(a)), mk(at(next, '05:00'), tap(c))];
		const resting = [
			mk(at(notebook.day, '22:00'), tap(a)),
			mk(at(notebook.day, '23:00'), rest),
			mk(at(next, '05:00'), tap(c))
		];
		for (const marks of [working, resting]) {
			expect(splitSwitches(viewOf(marks, 0, next).switchLog, areas)).toEqual(split(1, 0, 0));
		}
	});

	it.each([
		['every 10 minutes, taps as given', 10, 0],
		['every 2 minutes, quick taps read as holds', 2, 5]
	])('counts every switch exactly once: %s', (_name, spacing, bounce) => {
		for (const [, gestures] of cases) {
			const v = viewOf(marksOf(gestures, spacing), bounce);
			const s = splitSwitches(v.switchLog, areas);
			expect(v.switchLog).toHaveLength(v.switches);
			expect(s.total).toBe(v.switches);
			expect(s.hard + s.soft + s.unsorted).toBe(s.total);
		}
	});
});

describe('retagging', () => {
	const view = day(tap(a), tap(c), tap(b));
	it.each([
		['work', 'work', 'college', split(2, 0, 0)],
		['work', 'work', 'work', split(0, 2, 0)],
		['work', 'work', null, split(0, 0, 2)],
		[null, 'work', 'college', split(1, 0, 1)]
	])('a %s, b %s, c %s', (ta, tb, tc, expected) => {
		const retagged = areasOf([task(a, ta), task(b, tb), task(c, tc)]);
		expect(splitSwitches(view.switchLog, retagged)).toEqual(expected);
	});
});

describe('the hard count to show', () => {
	it('is null when no switch could be sorted, so no tags reads as unknown', () => {
		expect(hardOf(split(0, 0, 4))).toBeNull();
		expect(hardOf(split(0, 0, 0))).toBeNull();
		expect(hardOf(split(0, 1, 4))).toBe(0);
		expect(hardOf(split(3, 0, 1))).toBe(3);
	});
});

describe('the tags in use', () => {
	it('lists tags by active tasks, most first, then by name, with tags only on finished tasks last', () => {
		const known = areasOf([
			task(a, 'college'),
			task(b, 'work'),
			task(c, 'work'),
			task(d, 'chores'),
			task(u, 'old job', 'done'),
			task('t_v' as TaskId, null)
		]).known;
		expect(known).toEqual(['work', 'chores', 'college', 'old job']);
	});

	it('reads no tag for a task it does not know', () => {
		expect(areas.of('t_ghost' as TaskId)).toBeNull();
	});
});

describe('the notebook day by tag', () => {
	const range = rangeOf(notebook.day, notebook.settings);
	const view = deriveDay(notebook.marks, range, carryIn(notebook.marks, range.start), false);
	const agg = aggregateDay(view, notebook.settings);
	const tags = (codeTag: string | null): Areas =>
		areasOf([
			task(notebook.mail, 'work'),
			task(notebook.slack, 'work'),
			task(notebook.report, 'college'),
			task(notebook.code, codeTag)
		]);

	it('classifies its 11 switches', () => {
		expect(splitSwitches(agg.switchLog, tags(null))).toEqual(split(4, 1, 6));
	});

	it('reclassifies them when code is tagged work', () => {
		expect(splitSwitches(agg.switchLog, tags('work'))).toEqual(split(6, 5, 0));
	});

	it('breaks switches, focus and juggle time down by tag, adding up to the day', () => {
		const out = areaBreakdown([agg], tags(null));
		expect(out.switches).toEqual(split(4, 1, 6));
		expect(out.rows).toEqual([
			{ area: 'college', switches: split(2, 0, 1), focusMs: 230 * MIN, juggleMs: 35 * MIN },
			{
				area: 'work',
				switches: split(2, 1, 3),
				focusMs: 89 * MIN + 10 * SEC,
				juggleMs: 49 * MIN + 10 * SEC
			},
			{
				area: null,
				switches: split(0, 0, 2),
				focusMs: 240 * MIN + 50 * SEC,
				juggleMs: 70 * MIN + 50 * SEC
			}
		]);
		const sum = (f: (r: (typeof out.rows)[number]) => number) =>
			out.rows.reduce((n, r) => n + f(r), 0);
		expect(sum((r) => r.focusMs)).toBe(agg.focusMs);
		expect(sum((r) => r.juggleMs)).toBe(agg.juggleMs);
		expect(sum((r) => r.switches.total)).toBe(agg.switches);
	});

	it('adds days together', () => {
		const out = areaBreakdown([agg, agg], tags(null));
		expect(out.switches).toEqual(split(8, 2, 12));
		expect(out.rows[0]).toMatchObject({ area: 'college', focusMs: 460 * MIN });
	});
});
