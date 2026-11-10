import {
	CHECKIN_KEYS,
	parseCheckInValue,
	type CheckIn,
	type CheckInKey,
	type CheckInValue
} from '../domain/checkin';
import {
	dayKey,
	dayStartHour,
	gesture,
	hue,
	instant,
	note,
	parsePlanId,
	reason,
	taskStatus,
	timeZone,
	title,
	type Brand,
	type DayKey,
	type DayStartHour,
	type Gesture,
	type Hue,
	type Instant,
	type Mark,
	type MarkId,
	type PlanEntry,
	type Reason,
	type Settings,
	type Task,
	type TaskId,
	type TaskStatus,
	type TimeZone,
	type Title
} from '../domain/model';

/**
 * Every replicated entity is a bag of last-writer-wins registers, one per field, and every
 * change is an op that writes some fields of one entity at one hybrid logical clock.
 * merge keeps the greater clock per field, so any replica that has seen the same ops holds
 * the same records, whatever order they arrived in. Nothing here knows a domain rule;
 * the schema only says which kinds exist and how each field's value reads.
 */

/** The fields of each kind, as the domain reads them. */
export type Fields = {
	task: {
		title: Title;
		note: string | null;
		hue: Hue;
		deadline: Instant | null;
		longRunning: boolean;
		status: TaskStatus;
		createdAt: Instant;
	};
	mark: { at: Instant; gesture: Gesture; voided: boolean; reason: Reason | null };
	plan: { on: boolean; rank: string };
	checkin: { [K in CheckInKey]: CheckInValue<K> | null };
	settings: { timeZone: TimeZone; dayStartHour: DayStartHour };
};

export type Kind = keyof Fields;

type Ids = { task: TaskId; mark: MarkId; plan: string; checkin: DayKey; settings: 'user' };

/** A stored or wire value to a field value; undefined when it does not parse. */
type Codec<T> = (json: unknown) => T | undefined;

const req =
	<T>(f: (json: unknown) => T | null): Codec<T> =>
	(json) =>
		f(json) ?? undefined;
const orNull =
	<T>(f: (json: unknown) => T | null): Codec<T | null> =>
	(json) =>
		json === null ? null : (f(json) ?? undefined);
const bool: Codec<boolean> = (json) => (typeof json === 'boolean' ? json : undefined);
const rank: Codec<string> = (json) =>
	typeof json === 'string' && /^[0-9a-z]{0,64}$/.test(json) ? json : undefined;

const checkinCodecs = Object.fromEntries(
	CHECKIN_KEYS.map((k) => [
		k,
		(json: unknown) => (json === null ? null : parseCheckInValue(k, json))
	])
) as { [K in CheckInKey]: Codec<CheckInValue<K> | null> };

/** The one list of replicated kinds and their fields. */
export const SCHEMA: {
	readonly [K in Kind]: { readonly [F in keyof Fields[K]]-?: Codec<Fields[K][F]> };
} = {
	task: {
		title: req(title),
		note: orNull(note),
		hue: req(hue),
		deadline: orNull(instant),
		longRunning: bool,
		status: req(taskStatus),
		createdAt: req(instant)
	},
	mark: { at: req(instant), gesture: req(gesture), voided: bool, reason: orNull(reason) },
	plan: { on: bool, rank },
	checkin: checkinCodecs,
	settings: { timeZone: req(timeZone), dayStartHour: req(dayStartHour) }
};

export const KINDS = Object.keys(SCHEMA) as Kind[];

export function isKind(kind: string): kind is Kind {
	return Object.hasOwn(SCHEMA, kind);
}

/** What the domain decides: some fields of one entity. The replica stamps the clock. */
export type Change = {
	[K in Kind]: {
		readonly kind: K;
		readonly id: Ids[K];
		readonly set: { readonly [F in keyof Fields[K]]?: Fields[K][F] };
	};
}[Kind];

/**
 * 23 chars of base36: 9 wall-clock ms, 4 counter, 10 replica id. Fixed width, so string
 * order is clock order. It is also the op's identity, which the server dedupes on.
 */
export type Hlc = Brand<string, 'Hlc'>;

/** A stamped change as stored and sent. `set` may hold fields a newer build wrote. */
export type Op = {
	readonly hlc: Hlc;
	readonly kind: string;
	readonly id: string;
	readonly set: Readonly<Record<string, unknown>>;
};

const HLC = /^[0-9a-z]{23}$/;
const KIND = /^[a-z][a-z0-9_]{0,31}$/;
const ID = /^[A-Za-z0-9_:-]{1,128}$/;
const MAX_OP_BYTES = 16 * 1024;
const COUNTER_LIMIT = 36 ** 4;

export function newReplicaId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(10));
	return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/**
 * One clock per JS context. Each context mints its own replica id, so two tabs on one
 * device can never stamp the same clock value and need no shared counter.
 */
export class Clock {
	readonly replica: string;
	#wall = 0;
	#counter = 0;

	constructor(replica: string, floor: Hlc | null = null) {
		if (!/^[0-9a-z]{10}$/.test(replica)) throw new RangeError(`bad replica id ${replica}`);
		this.replica = replica;
		if (floor) this.observe(floor);
	}

	tick(now: number): Hlc {
		if (now > this.#wall) {
			this.#wall = now;
			this.#counter = 0;
		} else if (++this.#counter >= COUNTER_LIMIT) {
			this.#wall++;
			this.#counter = 0;
		}
		return (this.#wall.toString(36).padStart(9, '0') +
			this.#counter.toString(36).padStart(4, '0') +
			this.replica) as Hlc;
	}

	/** Move past a seen clock, so an edit made after seeing it sorts after it. */
	observe(seen: Hlc): void {
		const wall = parseInt(seen.slice(0, 9), 36);
		const counter = parseInt(seen.slice(9, 13), 36);
		if (wall > this.#wall || (wall === this.#wall && counter > this.#counter)) {
			this.#wall = wall;
			this.#counter = counter;
		}
	}
}

export function stamp(change: Change, hlc: Hlc): Op {
	const set: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(change.set)) if (v !== undefined) set[k] = v;
	return { hlc, kind: change.kind, id: change.id, set };
}

export type Register = { readonly v: unknown; readonly h: Hlc };

/** An entity as stored: every register ever written to it, known to this build or not. */
export type Rec = { readonly id: string; readonly regs: Readonly<Record<string, Register>> };

function joinRegs(
	into: Rec | undefined,
	id: string,
	regs: Iterable<readonly [string, Register]>
): Rec | undefined {
	let next: Record<string, Register> | null = null;
	for (const [f, r] of regs) {
		const cur = (next ?? into?.regs)?.[f];
		if (cur && cur.h >= r.h) continue;
		next ??= { ...into?.regs };
		next[f] = r;
	}
	return next ? { id, regs: next } : into;
}

/** Join an op into a record. Returns `rec` itself when the op changes nothing. */
export function merge(rec: Rec | undefined, op: Op): Rec {
	const regs = Object.entries(op.set).map(([f, v]) => [f, { v, h: op.hlc }] as const);
	return joinRegs(rec, op.id, regs) ?? { id: op.id, regs: {} };
}

/** Join two records of one entity. Returns `a` itself when `b` adds nothing. */
export function join(a: Rec | undefined, b: Rec): Rec {
	return joinRegs(a, b.id, Object.entries(b.regs)) ?? b;
}

/**
 * Rebuild ops from a record, one per clock value, to re-seed a server that lost data.
 * A rebuilt op lacks only fields that later writes overwrote, so re-sending is safe.
 */
export function opsFromRecord(kind: string, rec: Rec): Op[] {
	const byHlc = new Map<Hlc, Record<string, unknown>>();
	for (const [f, r] of Object.entries(rec.regs)) {
		let set = byHlc.get(r.h);
		if (!set) byHlc.set(r.h, (set = {}));
		set[f] = r.v;
	}
	return [...byHlc]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([hlc, set]) => ({ hlc, kind, id: rec.id, set }));
}

/** The highest clock in a record, or null when it has none. */
export function maxHlc(rec: Rec): Hlc | null {
	let max: Hlc | null = null;
	for (const r of Object.values(rec.regs)) if (max === null || r.h > max) max = r.h;
	return max;
}

function isPlainObject(json: unknown): json is Record<string, unknown> {
	return typeof json === 'object' && json !== null && !Array.isArray(json);
}

/**
 * Wire JSON to an Op. Checks the envelope only, the same checks the server makes. Field
 * values are read later through the schema, so a value this build cannot read is kept and
 * relayed rather than dropped. An op of an unknown kind parses; the replica stores it aside.
 */
export function parseOp(json: unknown): Op | null {
	if (!isPlainObject(json)) return null;
	const { hlc, kind, id, set } = json;
	if (typeof hlc !== 'string' || !HLC.test(hlc)) return null;
	if (typeof kind !== 'string' || !KIND.test(kind)) return null;
	if (typeof id !== 'string' || !ID.test(id)) return null;
	if (!isPlainObject(set) || Object.keys(set).length === 0) return null;
	if (new TextEncoder().encode(JSON.stringify(json)).length > MAX_OP_BYTES) return null;
	return { hlc: hlc as Hlc, kind, id, set };
}

export type Entity = {
	task: Task;
	mark: Mark;
	plan: PlanEntry;
	checkin: { readonly day: DayKey; readonly values: CheckIn };
	settings: Partial<Settings>;
};

function read<K extends Kind>(kind: K, rec: Rec): Partial<Fields[K]> {
	const codecs = SCHEMA[kind] as Record<string, Codec<unknown>>;
	const out: Record<string, unknown> = {};
	for (const [f, r] of Object.entries(rec.regs)) {
		const codec = codecs[f];
		if (!codec) continue;
		const v = codec(r.v);
		if (v !== undefined) out[f] = v;
	}
	return out as Partial<Fields[K]>;
}

const builders: { [K in Kind]: (rec: Rec) => Entity[K] | null } = {
	task(rec) {
		const f = read('task', rec);
		const id = rec.id as TaskId;
		if (!f.title) return null;
		return {
			id,
			title: f.title,
			note: f.note ?? null,
			hue: f.hue ?? (0 as Hue),
			deadline: f.deadline ?? null,
			longRunning: f.longRunning ?? false,
			status: f.status ?? 'active',
			createdAt: f.createdAt ?? (0 as Instant)
		};
	},
	mark(rec) {
		const f = read('mark', rec);
		if (f.at === undefined || !f.gesture) return null;
		return {
			id: rec.id as MarkId,
			at: f.at,
			gesture: f.gesture,
			voided: f.voided ?? false,
			reason: f.reason ?? null
		};
	},
	plan(rec) {
		const key = parsePlanId(rec.id);
		if (!key) return null;
		const f = read('plan', rec);
		return { ...key, on: f.on ?? false, rank: f.rank ?? '' };
	},
	checkin(rec) {
		const day = dayKey(rec.id);
		if (!day) return null;
		const values: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(read('checkin', rec))) if (v !== null) values[k] = v;
		return { day, values: values as CheckIn };
	},
	settings(rec) {
		return read('settings', rec);
	}
};

const parsed = new WeakMap<Rec, unknown>();

/** A record as a domain entity, or null when a required field is missing or unreadable. */
export function parseEntity<K extends Kind>(kind: K, rec: Rec): Entity[K] | null {
	if (parsed.has(rec)) return parsed.get(rec) as Entity[K] | null;
	const e = builders[kind](rec);
	parsed.set(rec, e);
	return e;
}
