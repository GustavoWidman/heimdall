import type { Focus, Mark, Task, TaskId, Transition, TransitionKind } from '#lib/app/app.svelte.ts';

/**
 * One line of a day's switch ledger. A mark that counts carries what it did; a voided
 * mark changes nothing, so only its gesture is known and it is shown struck through.
 */
export type LedgerRow =
	| ({ readonly voided: false; readonly mark: Mark } & Pick<Transition, 'kind' | 'from' | 'to'>)
	| { readonly voided: true; readonly mark: Mark };

/** Every mark of the day in timeline order, joined to the transition it made. */
export function ledger(
	marks: readonly Mark[],
	transitions: readonly Transition[]
): readonly LedgerRow[] {
	const byMark = new Map(transitions.map((t) => [t.mark, t]));
	return marks.flatMap((mark): LedgerRow[] => {
		const t = byMark.get(mark.id);
		if (mark.voided || !t) return [{ voided: true, mark }];
		return [{ voided: false, mark, kind: t.kind, from: t.from, to: t.to }];
	});
}

export const KIND_LABEL: Readonly<Record<TransitionKind, string>> = {
	start: 'start',
	switch: 'switch',
	resume: 'resume',
	narrow: 'narrow',
	rest: 'rest',
	off: 'off',
	none: 'no change'
};

export type FocusPart =
	| { readonly k: 'off' | 'rest' }
	| { readonly k: 'task'; readonly task: TaskId; readonly title: string; readonly hue: number };

/** A focus as the pieces a ledger line draws: off, rest, or each task held. */
export function focusParts(f: Focus, task: (id: TaskId) => Task | undefined): FocusPart[] {
	if (f.k !== 'working') return [{ k: f.k }];
	return f.tasks.map((id) => {
		const t = task(id);
		return { k: 'task', task: id, title: t?.title ?? 'a removed task', hue: t?.hue ?? 0 };
	});
}
