<!-- The window at a glance: a handful of numbers, each with one line of context. -->
<script lang="ts">
	import type { DayKey, Insights } from '#lib/app/app.svelte.ts';
	import { dayLabel, spent } from '#lib/ui/format.ts';

	let { data, today }: { data: Insights; today: DayKey } = $props();

	const r = Math.round;
	const points = $derived(data.series);
	const closed = $derived(points.filter((p) => p.tracked && p.day !== today));
	const now = $derived(points.find((p) => p.day === today));
	const base = $derived(data.baseline);

	const medians = $derived(
		closed.flatMap((p) => (p.stretchMedianMs === null ? [] : [p.stretchMedianMs]))
	);
	const typicalStretch = $derived.by(() => {
		if (!medians.length) return null;
		const s = [...medians].sort((a, b) => a - b);
		const m = s.length >> 1;
		return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
	});
	const longest = $derived(
		points.reduce<(typeof points)[number] | null>(
			(best, p) => ((p.stretchLongestMs ?? 0) > (best?.stretchLongestMs ?? 0) ? p : best),
			null
		)
	);

	const t = $derived(data.totals);
	const juggle = $derived(t.focusMs > 0 ? t.juggleMs / t.focusMs : null);
	const answered = $derived(points.filter((p) => p.strain !== null || p.stress !== null));
	const strainAvg = $derived.by(() => {
		const xs = points.flatMap((p) => (p.strain === null ? [] : [p.strain]));
		return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
	});
</script>

<dl class="tiles">
	<div>
		<dt class="label">usual day</dt>
		<dd class="value">{base ? r(base.median) : '–'}</dd>
		<dd class="sub">
			{base
				? `switches · most days ${r(base.lo)}–${r(base.hi)}`
				: `usual range after 5 full days, ${closed.length} here`}
		</dd>
	</div>
	<div>
		<dt class="label">today</dt>
		<dd class="value">{now?.switches ?? 0}</dd>
		<dd class="sub">switches so far</dd>
	</div>
	<div>
		<dt class="label">typical stretch</dt>
		<dd class="value">{typicalStretch === null ? '–' : spent(typicalStretch)}</dd>
		<dd class="sub">
			{#if longest?.stretchLongestMs}
				longest {spent(longest.stretchLongestMs)}, {dayLabel(longest.day)}
			{:else}
				on one thing before moving on
			{/if}
		</dd>
	</div>
	<div>
		<dt class="label">juggling</dt>
		<dd class="value">{juggle === null ? '–' : `${r(juggle * 100)}%`}</dd>
		<dd class="sub">
			{juggle === null ? 'of focused time' : `of ${spent(t.focusMs)} focused`}
		</dd>
	</div>
	<div>
		<dt class="label">check-ins</dt>
		<dd class="value">{answered.length}</dd>
		<dd class="sub">
			{#if strainAvg !== null}
				strain averaged {strainAvg.toFixed(1)} of 5
			{:else}
				none in these days
			{/if}
		</dd>
	</div>
</dl>

<style>
	.tiles {
		grid-area: tiles;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		border: 1px solid var(--rule-2);
		border-radius: 16px;
		overflow: hidden;
		background: var(--rule-2);
	}
	.tiles > div {
		padding: 14px 16px 14px;
		background: var(--panel);
		min-width: 0;
	}
	.tiles > div:first-child {
		grid-column: 1 / -1;
	}
	.value {
		margin-top: 4px;
		font-size: 30px;
		font-weight: 520;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}
	.sub {
		margin-top: 2px;
		font-size: 12.5px;
		color: var(--ink-3);
	}
	@media (min-width: 1000px) {
		.tiles {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
		.tiles > div:first-child {
			grid-column: auto;
		}
		.tiles > div {
			padding: 18px 20px;
		}
		.value {
			font-size: 36px;
		}
	}
</style>
