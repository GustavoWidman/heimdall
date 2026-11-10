import { describe, expect, it } from 'vitest';
import {
	TaskSet,
	type DayKey,
	type DayStartHour,
	type Focus,
	type Gesture,
	type Instant,
	type Mark,
	type MarkId,
	type Settings,
	type TaskId,
	type TimeZone
} from './model';
import {
	FOLD_START,
	carryIn,
	daysTouchedBy,
	deriveDay,
	focusAt,
	liveTotals,
	step,
	type FoldState,
	type TransitionKind
} from './focus';
import { dayOf, rangeOf } from './time';
import * as notebook from './notebook-day.fixture';

const a = 't_a' as TaskId;
const b = 't_b' as TaskId;
const c = 't_c' as TaskId;
const set = (...ts: TaskId[]) => TaskSet.from(ts) as TaskSet;

const off: FoldState = FOLD_START;
const working = (...ts: TaskId[]): FoldState => ({
	focus: { k: 'working', tasks: set(...ts) },
	held: null
});
const resting = (...held: TaskId[]): FoldState => ({
	focus: { k: 'rest' },
	held: held.length ? set(...held) : null
});

const tap = (task: TaskId): Gesture => ({ k: 'tap', task });
const hold = (task: TaskId): Gesture => ({ k: 'hold', task });
const release = (task: TaskId): Gesture => ({ k: 'release', task });
const rest: Gesture = { k: 'rest' };
const offG: Gesture = { k: 'off' };

describe('the switching table', () => {
	const rows: [string, FoldState, Gesture, FoldState, TransitionKind, TaskId | null][] = [
		['tap t in S, S has others', working(a, b), tap(a), working(a), 'narrow', null],
		['tap t in S, S = {t}', working(a), tap(a), working(a), 'none', null],
		['tap t not in S, from working', working(a), tap(b), working(b), 'switch', b],
		['tap t from rest, t held', resting(a, b), tap(a), working(a), 'resume', a],
		['tap t from rest, t not held', resting(a), tap(b), working(b), 'switch', b],
		['tap t from off', off, tap(a), working(a), 'start', a],
		['tap t from rest with nothing held', resting(), tap(a), working(a), 'start', a],
		['hold t not in S, from working', working(a), hold(b), working(a, b), 'switch', b],
		['hold t from rest, t held', resting(a), hold(a), working(a), 'resume', a],
		['hold t from rest, t not held', resting(a), hold(b), working(b), 'switch', b],
		['hold t from off', off, hold(a), working(a), 'start', a],
		['hold t from rest with nothing held', resting(), hold(a), working(a), 'start', a],
		['hold t in S', working(a, b), hold(a), working(a, b), 'none', null],
		['release t in S, S has others', working(a, b), release(a), working(b), 'narrow', null],
		['release t from rest', resting(a), release(a), resting(a), 'none', null],
		['release t from off', off, release(a), off, 'none', null],
		['release t, S = {t}', working(a), release(a), resting(a), 'rest', null],
		['rest from working', working(a, b), rest, resting(a, b), 'rest', null],
		['rest from rest', resting(a), rest, resting(a), 'none', null],
		['rest from off', off, rest, off, 'none', null],
		['off from working', working(a), offG, off, 'off', null],
		['off from rest', resting(a), offG, off, 'off', null],
		['off from off', off, offG, off, 'none', null],
		['release t not in S (outside the table)', working(a), release(b), working(a), 'none', null]
	];

	it.each(rows)('%s', (_name, from, gesture, next, kind, entered) => {
		expect(step(from, gesture)).toEqual({ next, kind, entered });
	});
});

const settings: Settings = {
	timeZone: 'America/Sao_Paulo' as TimeZone,
	dayStartHour: 4 as DayStartHour
};
const DAY = '2026-11-09' as DayKey;
const MIN = 60_000;
const at = (hhmm: string, date: string = DAY) => Date.parse(`${date}T${hhmm}:00-03:00`) as Instant;

let seq = 0;
function mark(when: Instant, gesture: Gesture, voided = false): Mark {
	return {
		id: `m_${String(++seq).padStart(3, '0')}` as MarkId,
		at: when,
		gesture,
		voided,
		reason: null
	};
}

function closedDay(marks: readonly Mark[], day: DayKey = DAY) {
	const range = rangeOf(day, settings);
	return deriveDay(marks, range, carryIn(marks, range.start), false);
}

const kinds = (marks: readonly Mark[]) => closedDay(marks).transitions.map((t) => t.kind);
const focusOf = (...ts: TaskId[]): Focus => ({ k: 'working', tasks: set(...ts) });

describe('walk-throughs', () => {
	it('a to b is one switch', () => {
		const v = closedDay([mark(at('09:00'), tap(a)), mark(at('10:00'), tap(b))]);
		expect(v.transitions.map((t) => t.kind)).toEqual(['start', 'switch']);
		expect(v.switches).toBe(1);
	});

	it('a to a+b is one switch, and the juggle accrues to both', () => {
		const v = closedDay([
			mark(at('09:00'), tap(a)),
			mark(at('10:00'), hold(b)),
			mark(at('10:30'), offG)
		]);
		expect(v.switches).toBe(1);
		expect(v.totals.juggleMs).toBe(30 * MIN);
		expect(v.perTask.get(a)?.ms).toBe(90 * MIN);
		expect(v.perTask.get(b)?.ms).toBe(30 * MIN);
	});

	it('a+b to b is no switch', () => {
		expect(
			kinds([mark(at('09:00'), tap(a)), mark(at('09:10'), hold(b)), mark(at('09:20'), tap(b))])
		).toEqual(['start', 'switch', 'narrow']);
	});

	it('a to rest to a is a resume, not a switch', () => {
		const v = closedDay([
			mark(at('09:00'), tap(a)),
			mark(at('09:30'), rest),
			mark(at('09:40'), tap(a))
		]);
		expect(v.transitions.map((t) => t.kind)).toEqual(['start', 'rest', 'resume']);
		expect(v.switches).toBe(0);
		expect(v.perTask.get(a)?.ticks).toBe(2);
	});

	it('a to rest to b is one switch', () => {
		const v = closedDay([
			mark(at('09:00'), tap(a)),
			mark(at('09:30'), rest),
			mark(at('09:40'), tap(b))
		]);
		expect(v.switches).toBe(1);
		expect(v.lastSwitch?.entered).toBe(b);
	});

	it('a+b+c release c leaves a+b with no switch', () => {
		const v = closedDay([
			mark(at('09:00'), tap(a)),
			mark(at('09:10'), hold(b)),
			mark(at('09:20'), hold(c)),
			mark(at('09:30'), release(c))
		]);
		expect(v.switches).toBe(2);
		expect(v.transitions.at(-1)?.kind).toBe('narrow');
		expect(v.state.focus).toEqual(focusOf(a, b));
	});

	it('releasing the last task rests, and tapping it again resumes', () => {
		const v = closedDay([
			mark(at('09:00'), tap(a)),
			mark(at('09:30'), release(a)),
			mark(at('09:40'), tap(a))
		]);
		expect(v.transitions.map((t) => t.kind)).toEqual(['start', 'rest', 'resume']);
		expect(v.totals.restMs).toBe(10 * MIN);
	});

	it('puts a switch at 01:30 in the previous day when the day starts at 04:00', () => {
		const late = mark(at('01:30', '2026-11-10'), tap(b));
		const marks = [mark(at('22:00'), tap(a)), late];
		expect(dayOf(late.at, settings)).toBe(DAY);
		const v = closedDay(marks);
		expect(v.switches).toBe(1);
		expect(v.lastSwitch?.mark).toBe(late.id);
		expect(closedDay(marks, '2026-11-10' as DayKey).switches).toBe(0);
	});

	it('carries focus across 04:00 into the next day', () => {
		const marks = [mark(at('23:00'), tap(a)), mark(at('05:00', '2026-11-10'), tap(b))];
		const next = closedDay(marks, '2026-11-10' as DayKey);
		expect(next.carry.focus).toEqual(focusOf(a));
		expect(next.segments[0]).toMatchObject({
			start: at('04:00', '2026-11-10'),
			focus: focusOf(a),
			mark: null
		});
		expect(next.perTask.get(a)?.ms).toBe(60 * MIN);
		expect(next.transitions.map((t) => t.kind)).toEqual(['switch']);
		expect(next.switches).toBe(1);
	});

	it('reads focus left open for more than 24 hours as off at the next day start', () => {
		const marks = [mark(at('03:30'), tap(a))];
		const range = rangeOf('2026-11-09' as DayKey, settings);
		expect(carryIn(marks, range.start).focus).toEqual(focusOf(a));
		const later = rangeOf('2026-11-10' as DayKey, settings);
		expect(carryIn(marks, later.start).focus).toEqual({ k: 'off' });
	});

	it('re-derives later focus when a mark is voided', () => {
		const wrong = mark(at('10:00'), hold(b));
		const marks = [
			mark(at('09:00'), tap(a)),
			wrong,
			mark(at('11:00'), hold(c)),
			mark(at('12:00'), release(b))
		];
		const before = closedDay(marks);
		expect(before.state.focus).toEqual(focusOf(a, c));
		expect(before.switches).toBe(2);

		const after = closedDay(marks.map((m) => (m === wrong ? { ...m, voided: true } : m)));
		expect(after.transitions.map((t) => t.kind)).toEqual(['start', 'switch', 'none']);
		expect(after.state.focus).toEqual(focusOf(a, c));
		expect(after.switches).toBe(1);
		expect(after.perTask.has(b)).toBe(false);
		expect(focusAt(after, at('10:30'))).toEqual(focusOf(a));
	});

	it('re-derives the timeline when a mark is retimed before another', () => {
		const late = mark(at('12:00'), tap(c));
		const marks = [mark(at('10:00'), tap(a)), mark(at('11:00'), hold(b)), late];
		expect(closedDay(marks).state.focus).toEqual(focusOf(c));

		const retimed = closedDay(marks.map((m) => (m === late ? { ...m, at: at('10:30') } : m)));
		expect(retimed.transitions.map((t) => [t.mark, t.kind])).toEqual([
			[marks[0].id, 'start'],
			[late.id, 'switch'],
			[marks[1].id, 'switch']
		]);
		expect(retimed.state.focus).toEqual(focusOf(b, c));
		expect(retimed.perTask.get(a)?.ms).toBe(30 * MIN);
	});

	it('orders marks at the same instant by id on every device', () => {
		const t = at('10:00');
		const m1 = { ...mark(t, tap(a)), id: 'm_x1' as MarkId };
		const m2 = { ...mark(t, tap(b)), id: 'm_x2' as MarkId };
		expect(closedDay([m2, m1]).state.focus).toEqual(focusOf(b));
		expect(closedDay([m1, m2]).state.focus).toEqual(focusOf(b));
	});
});

describe('a realistic notebook day', () => {
	const range = rangeOf(notebook.day, notebook.settings);
	const view = deriveDay(notebook.marks, range, carryIn(notebook.marks, range.start), false);

	it('counts switches and ticks', () => {
		expect(view.switches).toBe(notebook.expected.switches);
		expect(view.ticks).toBe(notebook.expected.ticks);
	});

	it('totals focus, juggle, load, and rest time', () => {
		expect(view.totals).toEqual({
			focusMs: notebook.expected.focusMs,
			juggleMs: notebook.expected.juggleMs,
			loadMs: notebook.expected.loadMs,
			restMs: notebook.expected.restMs
		});
	});

	it('weighs load by the tasks held, the same as summing every task', () => {
		const perTask = [...view.perTask.values()].reduce((sum, d) => sum + d.ms, 0);
		expect(view.totals.loadMs).toBe(perTask);
	});

	it('breaks the day down per task', () => {
		expect(new Map(view.perTask)).toEqual(notebook.expected.perTask);
	});

	it('tiles the whole day with segments', () => {
		expect(view.segments[0].start).toBe(range.start);
		expect(view.segments.at(-1)?.end).toBe(range.end);
		for (let i = 1; i < view.segments.length; i++) {
			expect(view.segments[i].start).toBe(view.segments[i - 1].end);
		}
	});
});

describe('a live day', () => {
	const range = rangeOf(DAY, settings);
	const marks = [mark(at('09:00'), tap(a)), mark(at('10:00'), hold(b))];
	const view = deriveDay(marks, range, carryIn(marks, range.start), true);

	it('keeps the last stretch open and counts it only in live totals', () => {
		expect(view.tail).toEqual({
			start: at('10:00'),
			since: at('10:00'),
			focus: focusOf(a, b),
			mark: marks[1].id
		});
		expect(view.totals.focusMs).toBe(60 * MIN);
		const live = liveTotals(view, at('10:15'));
		expect(live.focusMs).toBe(75 * MIN);
		expect(live.juggleMs).toBe(15 * MIN);
		expect(live.loadMs).toBe(90 * MIN);
		expect(live.perTask.get(b)?.ms).toBe(15 * MIN);
		expect(focusAt(view, at('11:00'))).toEqual(focusOf(a, b));
	});
});

describe('a live day with focus carried in', () => {
	const marks = [mark(at('22:30'), tap(a)), mark(at('23:10'), hold(b))];
	const range = rangeOf('2026-11-10' as DayKey, settings);
	const view = deriveDay(marks, range, carryIn(marks, range.start), true);

	it('clips the open stretch to the day, and remembers when that focus began', () => {
		expect(view.tail).toMatchObject({
			start: range.start,
			since: at('23:10'),
			focus: focusOf(a, b),
			mark: null
		});
		expect(liveTotals(view, (range.start + 30 * MIN) as Instant).focusMs).toBe(30 * MIN);
	});
});

describe('daysTouchedBy', () => {
	it('names the mark day and the next day, whose carry reads it', () => {
		expect(daysTouchedBy(at('10:00'), settings)).toEqual(['2026-11-09', '2026-11-10']);
	});
});
