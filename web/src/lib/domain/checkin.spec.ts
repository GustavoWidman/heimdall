import { describe, expect, expectTypeOf, it } from 'vitest';
import { CHECKIN_FIELDS, parseCheckIn, parseCheckInValue, type CheckIn } from './checkin';

describe('check-in registry', () => {
	it('holds the core six, the two prominent counts, and the extended set', () => {
		const tiers = Object.fromEntries(
			Object.entries(CHECKIN_FIELDS).map(([k, d]) => [k, d.tier] as const)
		);
		expect(tiers).toEqual({
			stress: 'core',
			strain: 'core',
			mood: 'core',
			sleepQuality: 'core',
			headache: 'core',
			switchOff: 'core',
			cried: 'prominent',
			laughed: 'prominent',
			energy: 'extended',
			sleepHours: 'extended',
			exercise: 'extended',
			outdoors: 'extended',
			social: 'extended',
			caffeine: 'extended',
			meds: 'extended',
			note: 'extended'
		});
	});

	it('gives every scale and choice one label per value', () => {
		for (const def of Object.values(CHECKIN_FIELDS)) {
			if (def.kind === 'scale' || def.kind === 'choice') {
				expect(def.labels.length).toBe(def.values.length);
			}
		}
	});

	it('accepts only the allowed values', () => {
		expect(parseCheckInValue('headache', 3)).toBe(3);
		expect(parseCheckInValue('headache', 4)).toBeUndefined();
		expect(parseCheckInValue('strain', 0)).toBeUndefined();
		expect(parseCheckInValue('cried', 2)).toBe(2);
		expect(parseCheckInValue('sleepHours', 7.5)).toBe(7.5);
		expect(parseCheckInValue('sleepHours', 7.25)).toBeUndefined();
		expect(parseCheckInValue('sleepHours', 16.5)).toBeUndefined();
		expect(parseCheckInValue('meds', 'na')).toBe('na');
		expect(parseCheckInValue('meds', 'maybe')).toBeUndefined();
		expect(parseCheckInValue('note', 'x'.repeat(4000))).toHaveLength(4000);
		expect(parseCheckInValue('note', 'x'.repeat(4001))).toBeUndefined();
	});

	it('reads stored fields, dropping unknown keys and invalid values', () => {
		expect(
			parseCheckIn({ strain: 4, headache: 1, a_field_from_a_newer_build: [1, 2, 3], mood: 9 })
		).toEqual({ strain: 4, headache: 1 });
	});

	it('types each value from its field (checked by the type checker)', () => {
		expect(parseCheckIn({ headache: 2 }).headache).toBe(2);
		expectTypeOf<CheckIn['headache']>().toEqualTypeOf<0 | 1 | 2 | 3 | undefined>();
		expectTypeOf<CheckIn['exercise']>().toEqualTypeOf<'none' | 'light' | 'hard' | undefined>();
		expectTypeOf<CheckIn['sleepHours']>().toEqualTypeOf<number | undefined>();
	});
});
