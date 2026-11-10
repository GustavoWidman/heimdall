/**
 * The daily check-in, one record per day, every field optional and editable any time.
 * The registry below is the one list of fields: the CheckIn type, value parsing, the form,
 * and insights all derive from it, so adding a field is one entry. A key is permanent once
 * shipped; values under keys this build does not know stay in the replica untouched.
 */

type Tier = 'core' | 'prominent' | 'extended';

/** A question as asked on the day itself, and as asked looking back at an earlier day. */
export type Question = { readonly today: string; readonly past: string };

type Common = { readonly question: Question; readonly tier: Tier };

const sameDay = (text: string): Question => ({ today: text, past: text });

export type FieldDef =
	| (Common & {
			readonly kind: 'scale';
			readonly values: readonly number[];
			readonly labels: readonly string[];
	  })
	| (Common & {
			readonly kind: 'choice';
			readonly values: readonly string[];
			readonly labels: readonly string[];
	  })
	| (Common & {
			readonly kind: 'number';
			readonly min: number;
			readonly max: number;
			readonly step: number;
			readonly unit: string;
	  })
	| (Common & { readonly kind: 'text'; readonly maxLength: number });

const AMOUNT = ['not at all', 'a little', 'somewhat', 'quite', 'very'] as const;
const NONE_SOME_LOTS = {
	values: ['none', 'some', 'lots'],
	labels: ['none', 'some', 'lots']
} as const;
const COUNT = { values: [0, 1, 2], labels: ['0', '1', '2+'] } as const;
const ONE_TO_FIVE = [1, 2, 3, 4, 5] as const;

export const CHECKIN_FIELDS = {
	stress: {
		kind: 'scale',
		tier: 'core',
		question: {
			today: 'how stressed did today feel overall?',
			past: 'how stressed did the day feel overall?'
		},
		values: ONE_TO_FIVE,
		labels: AMOUNT
	},
	strain: {
		kind: 'scale',
		tier: 'core',
		question: {
			today: 'how mentally worn out do you feel right now?',
			past: 'how mentally worn out did you feel by the end of the day?'
		},
		values: ONE_TO_FIVE,
		labels: AMOUNT
	},
	mood: {
		kind: 'scale',
		tier: 'core',
		question: {
			today: 'how was your mood today, overall?',
			past: 'how was your mood that day, overall?'
		},
		values: ONE_TO_FIVE,
		labels: ['very low', 'low', 'okay', 'good', 'very good']
	},
	sleepQuality: {
		kind: 'scale',
		tier: 'core',
		question: {
			today: 'how did you sleep last night?',
			past: 'how did you sleep the night before?'
		},
		values: ONE_TO_FIVE,
		labels: ['very poor', 'poor', 'okay', 'good', 'very good']
	},
	headache: {
		kind: 'scale',
		tier: 'core',
		question: {
			today: 'any headache today? how bad at its worst?',
			past: 'any headache that day? how bad at its worst?'
		},
		values: [0, 1, 2, 3],
		labels: ['none', 'mild', 'moderate', 'severe']
	},
	switchOff: {
		kind: 'scale',
		tier: 'core',
		question: {
			today: 'could you mentally switch off from work this evening?',
			past: 'could you mentally switch off from work that evening?'
		},
		values: ONE_TO_FIVE,
		labels: ['not at all', 'a little', 'somewhat', 'mostly', 'completely']
	},
	cried: {
		kind: 'scale',
		tier: 'prominent',
		question: { today: 'did you cry today?', past: 'did you cry that day?' },
		...COUNT
	},
	laughed: {
		kind: 'scale',
		tier: 'prominent',
		question: { today: 'did you laugh today?', past: 'did you laugh that day?' },
		...COUNT
	},
	energy: {
		kind: 'scale',
		tier: 'extended',
		question: { today: 'how was your energy today?', past: 'how was your energy that day?' },
		values: ONE_TO_FIVE,
		labels: ['very low', 'low', 'okay', 'high', 'very high']
	},
	sleepHours: {
		kind: 'number',
		tier: 'extended',
		question: sameDay('about how many hours did you sleep?'),
		min: 0,
		max: 16,
		step: 0.5,
		unit: 'h'
	},
	exercise: {
		kind: 'choice',
		tier: 'extended',
		question: { today: 'did you exercise today?', past: 'did you exercise that day?' },
		values: ['none', 'light', 'hard'],
		labels: ['none', 'light', 'hard']
	},
	outdoors: {
		kind: 'choice',
		tier: 'extended',
		question: sameDay('did you spend time outdoors?'),
		...NONE_SOME_LOTS
	},
	social: {
		kind: 'choice',
		tier: 'extended',
		question: sameDay('did you spend time with other people?'),
		...NONE_SOME_LOTS
	},
	caffeine: {
		kind: 'scale',
		tier: 'extended',
		question: sameDay('how much caffeine did you have?'),
		values: [0, 1, 2],
		labels: ['none', '1-2', '3+']
	},
	meds: {
		kind: 'choice',
		tier: 'extended',
		question: sameDay('did you take your usual medication?'),
		values: ['yes', 'no', 'na'],
		labels: ['yes', 'no', 'not applicable']
	},
	note: {
		kind: 'text',
		tier: 'extended',
		question: sameDay('anything else worth remembering?'),
		maxLength: 4000
	}
} as const satisfies Record<string, FieldDef>;

export type CheckInKey = keyof typeof CHECKIN_FIELDS;

type ValueOf<D> = D extends {
	readonly kind: 'scale' | 'choice';
	readonly values: readonly (infer V)[];
}
	? V
	: D extends { readonly kind: 'number' }
		? number
		: string;

export type CheckInValue<K extends CheckInKey> = ValueOf<(typeof CHECKIN_FIELDS)[K]>;

/** A parsed check-in. An absent key was never set or was cleared. */
export type CheckIn = { readonly [K in CheckInKey]?: CheckInValue<K> };

/** One edit. null clears a field. */
export type CheckInPatch = { readonly [K in CheckInKey]?: CheckInValue<K> | null };

export const CHECKIN_KEYS = Object.keys(CHECKIN_FIELDS) as CheckInKey[];

export function isCheckInKey(key: string): key is CheckInKey {
	return Object.hasOwn(CHECKIN_FIELDS, key);
}

/** A stored or typed value, if it is valid for the field. */
export function parseCheckInValue<K extends CheckInKey>(
	key: K,
	json: unknown
): CheckInValue<K> | undefined {
	const def: FieldDef = CHECKIN_FIELDS[key];
	switch (def.kind) {
		case 'scale':
		case 'choice':
			return (def.values as readonly unknown[]).includes(json)
				? (json as CheckInValue<K>)
				: undefined;
		case 'number':
			return typeof json === 'number' &&
				json >= def.min &&
				json <= def.max &&
				Number.isInteger(json / def.step)
				? (json as CheckInValue<K>)
				: undefined;
		case 'text':
			return typeof json === 'string' && json.length <= def.maxLength
				? (json as CheckInValue<K>)
				: undefined;
	}
}

/** Stored fields to a CheckIn. Unknown keys and invalid values read as unset. */
export function parseCheckIn(fields: Readonly<Record<string, unknown>>): CheckIn {
	const out: Record<string, unknown> = {};
	for (const key of CHECKIN_KEYS) {
		const v = parseCheckInValue(key, fields[key]);
		if (v !== undefined) out[key] = v;
	}
	return out as CheckIn;
}
