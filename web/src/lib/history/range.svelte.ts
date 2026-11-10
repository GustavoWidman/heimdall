import type { App, DaySummary } from '#lib/app/app.svelte.ts';
import type { DaySpan } from './period';

/**
 * Per-day summaries for a span that can change, from `app.range`. Rows for another span
 * are never shown as this one's: `rows` is null until the current span has arrived. A
 * span holding today reloads as today's marks change. Create it during component init.
 */
export class RangeData {
	#got: { readonly key: string; readonly rows: readonly DaySummary[] } | null = $state(null);
	readonly #span: () => DaySpan;

	constructor(app: App, span: () => DaySpan) {
		this.#span = span;
		$effect(() => {
			const { from, to } = span();
			const today = app.today.day;
			if (from <= today && today <= to) void app.today.marks.length;
			let live = true;
			void app.range(from, to).then((rows) => {
				if (live) this.#got = { key: `${from}|${to}`, rows };
			});
			return () => {
				live = false;
			};
		});
	}

	get rows(): readonly DaySummary[] | null {
		const { from, to } = this.#span();
		return this.#got?.key === `${from}|${to}` ? this.#got.rows : null;
	}
}
