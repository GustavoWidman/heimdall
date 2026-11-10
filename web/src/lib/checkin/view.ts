import {
	CHECKIN_FIELDS,
	CHECKIN_KEYS,
	type CheckIn,
	type CheckInKey,
	type FieldDef
} from '#lib/app/app.svelte.ts';

const def = (key: CheckInKey): FieldDef => CHECKIN_FIELDS[key];

/** The registry split for the form: core and prominent always shown, extended folded away. */
export const SECTIONS = {
	shown: CHECKIN_KEYS.filter((k) => def(k).tier !== 'extended'),
	more: CHECKIN_KEYS.filter((k) => def(k).tier === 'extended')
} as const;

/** `sleepQuality` reads as `sleep quality`. */
export function fieldName(key: CheckInKey): string {
	return key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
}

/** How a stored answer reads back: its chip label, `7.5h`, or `a note`. */
export function answerLabel(key: CheckInKey, value: unknown): string {
	const d = def(key);
	switch (d.kind) {
		case 'scale':
		case 'choice': {
			const i = (d.values as readonly unknown[]).indexOf(value);
			return i >= 0 ? d.labels[i] : '';
		}
		case 'number':
			return `${value}${d.unit}`;
		case 'text':
			return 'a note';
	}
}

export type Summary = {
	readonly answered: number;
	readonly of: number;
	/** `stress · somewhat` pairs in registry order. */
	readonly parts: readonly { readonly name: string; readonly answer: string }[];
};

/** What the top line says once anything is filled; null while the day is blank. */
export function summarize(checkIn: CheckIn): Summary | null {
	const keys = CHECKIN_KEYS.filter((k) => checkIn[k] !== undefined);
	if (keys.length === 0) return null;
	return {
		answered: SECTIONS.shown.filter((k) => checkIn[k] !== undefined).length,
		of: SECTIONS.shown.length,
		parts: keys.map((k) => ({ name: fieldName(k), answer: answerLabel(k, checkIn[k]) }))
	};
}

/**
 * The evening, when Today offers the check-in: from 18:00 until the next day starts, so a
 * late night still counts as the evening of the day being lived.
 */
export function isEvening(minuteOfDay: number, dayStartHour: number): boolean {
	const hour = Math.floor(minuteOfDay / 60);
	return hour >= 18 || hour < dayStartHour;
}

/** The next value of a number field after a step, starting from `start` when unset. */
export function stepNumber(
	key: CheckInKey,
	value: number | undefined,
	by: -1 | 1,
	start: number
): number | undefined {
	const d = def(key);
	if (d.kind !== 'number') return undefined;
	if (value === undefined) return start;
	const next = Math.round((value + by * d.step) / d.step) * d.step;
	return Math.min(d.max, Math.max(d.min, next));
}
