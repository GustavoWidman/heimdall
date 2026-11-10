import { describe, expect, it } from 'vitest';
import { answerLabel, fieldName, isEvening, SECTIONS, stepNumber, summarize } from './view';

describe('check-in form layout', () => {
	it('shows the core six, then cried and laughed, and folds the rest under more', () => {
		expect(SECTIONS.shown).toEqual([
			'stress',
			'strain',
			'mood',
			'sleepQuality',
			'headache',
			'switchOff',
			'cried',
			'laughed'
		]);
		expect(SECTIONS.more).toContain('note');
		expect(SECTIONS.more).not.toContain('stress');
	});

	it('names a field in plain words', () => {
		expect(fieldName('sleepQuality')).toBe('sleep quality');
		expect(fieldName('stress')).toBe('stress');
	});
});

describe('reading answers back', () => {
	it('uses the chip label, the unit, or a note', () => {
		expect(answerLabel('mood', 4)).toBe('good');
		expect(answerLabel('cried', 2)).toBe('2+');
		expect(answerLabel('sleepHours', 7.5)).toBe('7.5h');
		expect(answerLabel('note', 'long day')).toBe('a note');
	});

	it('says nothing for a blank day', () => {
		expect(summarize({})).toBeNull();
	});

	it('counts the shown questions answered and lists every answer in registry order', () => {
		const s = summarize({ headache: 0, stress: 3, energy: 4 });
		expect(s?.answered).toBe(2);
		expect(s?.of).toBe(8);
		expect(s?.parts).toEqual([
			{ name: 'stress', answer: 'somewhat' },
			{ name: 'headache', answer: 'none' },
			{ name: 'energy', answer: 'high' }
		]);
	});
});

describe('the evening', () => {
	it('runs from 18:00 until the day starts again', () => {
		expect(isEvening(17 * 60 + 59, 4)).toBe(false);
		expect(isEvening(18 * 60, 4)).toBe(true);
		expect(isEvening(1 * 60 + 30, 4)).toBe(true);
		expect(isEvening(4 * 60, 4)).toBe(false);
		expect(isEvening(12 * 60, 0)).toBe(false);
	});
});

describe('stepping a number', () => {
	it('starts at a sensible value, then moves by the field step within its bounds', () => {
		expect(stepNumber('sleepHours', undefined, 1, 7)).toBe(7);
		expect(stepNumber('sleepHours', 7, 1, 7)).toBe(7.5);
		expect(stepNumber('sleepHours', 0, -1, 7)).toBe(0);
		expect(stepNumber('sleepHours', 16, 1, 7)).toBe(16);
	});
});
