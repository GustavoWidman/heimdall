import type {
	DayKey,
	DayStartHour,
	Gesture,
	Instant,
	Mark,
	MarkId,
	Reason,
	Settings,
	TaskId,
	TimeZone
} from './model';

/**
 * A worked notebook day in São Paulo (UTC-3, no DST), 30 marks, with every expected
 * number counted by hand from the switching table rather than by running the code.
 */
export const settings: Settings = {
	timeZone: 'America/Sao_Paulo' as TimeZone,
	dayStartHour: 4 as DayStartHour
};
export const day = '2026-11-09' as DayKey;

export const mail = 't_mail' as TaskId;
export const report = 't_report' as TaskId;
export const code = 't_code' as TaskId;
export const slack = 't_slack' as TaskId;

export function local(date: string, hhmm: string): Instant {
	return Date.parse(`${date}T${hhmm}:00-03:00`) as Instant;
}

const tap = (task: TaskId): Gesture => ({ k: 'tap', task });
const hold = (task: TaskId): Gesture => ({ k: 'hold', task });
const release = (task: TaskId): Gesture => ({ k: 'release', task });
const rest: Gesture = { k: 'rest' };
const off: Gesture = { k: 'off' };

let n = 0;
function mark(
	hhmm: string,
	gesture: Gesture,
	extra: { voided?: boolean; reason?: Reason } = {}
): Mark {
	n++;
	return {
		id: `m_${String(n).padStart(2, '0')}` as MarkId,
		at: local(day, hhmm),
		gesture,
		voided: extra.voided ?? false,
		reason: extra.reason ?? null
	};
}

export const marks: readonly Mark[] = [
	mark('08:00', tap(mail)), // start
	mark('08:20', tap(report), { reason: 'pulled' }), // switch
	mark('08:50', hold(slack)), // switch, juggle report+slack
	mark('09:00', tap(report)), // narrow
	mark('09:30', tap(report)), // none, a repeat
	mark('09:40', rest), // rest, holding report
	mark('09:50', tap(report)), // resume
	mark('10:30', tap(code), { reason: 'urge' }), // switch
	mark('10:45', hold(mail)), // switch, code+mail
	mark('10:50', hold(slack)), // switch, code+mail+slack
	mark('11:00', release(slack)), // narrow
	mark('11:10', release(mail)), // narrow
	mark('12:00', rest), // rest, holding code
	mark('13:00', tap(mail)), // switch, mail was not held
	mark('13:15', tap(code)), // switch
	mark('14:00', hold(report)), // switch, code+report
	mark('14:30', hold(report)), // none
	mark('15:00', release(code)), // narrow
	mark('15:20', release(report)), // rest, holding report
	mark('15:30', hold(report)), // resume
	mark('16:00', tap(slack), { reason: 'urge' }), // switch
	mark('16:05', tap(report)), // switch
	mark('16:40', off), // off
	mark('17:00', rest), // none, from off
	mark('17:10', release(report)), // none, from off
	mark('19:00', tap(code)), // start
	mark('19:30', tap(slack), { voided: true }), // voided, ignored
	mark('20:00', hold(mail)), // switch, code+mail
	mark('21:00', off), // off
	mark('22:00', off) // none
];

const MIN = 60_000;

export const expected = {
	switches: 11,
	ticks: 15,
	focusMs: 560 * MIN,
	juggleMs: 155 * MIN,
	restMs: 80 * MIN,
	perTask: new Map([
		[mail, { ticks: 4, switchesIn: 3, ms: 120 * MIN }],
		[report, { ticks: 5, switchesIn: 3, ms: 265 * MIN }],
		[slack, { ticks: 3, switchesIn: 3, ms: 25 * MIN }],
		[code, { ticks: 3, switchesIn: 2, ms: 315 * MIN }]
	]),
	reasons: { done: 0, blocked: 0, urge: 2, pulled: 1, untagged: 8 },
	switchesByHour: { 8: 2, 10: 3, 13: 2, 14: 1, 16: 2, 20: 1 } as Record<number, number>
};
