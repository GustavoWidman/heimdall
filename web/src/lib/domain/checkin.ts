/**
 * The daily check-in, one record per day, every field optional and editable any time.
 * The registry below is the one list of fields: the CheckIn type, value parsing, the form,
 * and insights all derive from it, so adding a field is one entry. A key is permanent once
 * shipped; values under keys this build does not know stay in the replica untouched.
 */

type Tier = 'core' | 'prominent' | 'extended';

type Common = { readonly question: string; readonly tier: Tier };

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
		question: 'How stressed did today feel overall?',
		values: ONE_TO_FIVE,
		labels: AMOUNT
	},
	strain: {
		kind: 'scale',
		tier: 'core',
		question: 'How mentally worn out do you feel right now?',
		values: ONE_TO_FIVE,
		labels: AMOUNT
	},
	mood: {
		kind: 'scale',
		tier: 'core',
		question: 'How was your mood today, overall?',
		values: ONE_TO_FIVE,
		labels: ['very low', 'low', 'okay', 'good', 'very good']
	},
	sleepQuality: {
		kind: 'scale',
		tier: 'core',
		question: 'How did you sleep last night?',
		values: ONE_TO_FIVE,
		labels: ['very poor', 'poor', 'okay', 'good', 'very good']
	},
	headache: {
		kind: 'scale',
		tier: 'core',
		question: 'Any headache today? How bad at its worst?',
		values: [0, 1, 2, 3],
		labels: ['none', 'mild', 'moderate', 'severe']
	},
	switchOff: {
		kind: 'scale',
		tier: 'core',
		question: 'Could you mentally switch off from work this evening?',
		values: ONE_TO_FIVE,
		labels: ['not at all', 'a little', 'somewhat', 'mostly', 'completely']
	},
	cried: { kind: 'scale', tier: 'prominent', question: 'Did you cry today?', ...COUNT },
	laughed: { kind: 'scale', tier: 'prominent', question: 'Did you laugh today?', ...COUNT },
	energy: {
		kind: 'scale',
		tier: 'extended',
		question: 'How was your energy today?',
		values: ONE_TO_FIVE,
		labels: ['very low', 'low', 'okay', 'high', 'very high']
	},
	sleepHours: {
		kind: 'number',
		tier: 'extended',
		question: 'About how many hours did you sleep?',
		min: 0,
		max: 16,
		step: 0.5,
		unit: 'h'
	},
	exercise: {
		kind: 'choice',
		tier: 'extended',
		question: 'Did you exercise today?',
		values: ['none', 'light', 'hard'],
		labels: ['none', 'light', 'hard']
	},
	outdoors: {
		kind: 'choice',
		tier: 'extended',
		question: 'Did you spend time outdoors?',
		...NONE_SOME_LOTS
	},
	social: {
		kind: 'choice',
		tier: 'extended',
		question: 'Did you spend time with other people?',
		...NONE_SOME_LOTS
	},
	caffeine: {
		kind: 'scale',
		tier: 'extended',
		question: 'How much caffeine did you have?',
		values: [0, 1, 2],
		labels: ['none', '1-2', '3+']
	},
	meds: {
		kind: 'choice',
		tier: 'extended',
		question: 'Did you take your usual medication?',
		values: ['yes', 'no', 'na'],
		labels: ['yes', 'no', 'not applicable']
	},
	note: {
		kind: 'text',
		tier: 'extended',
		question: 'Anything else worth remembering?',
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
