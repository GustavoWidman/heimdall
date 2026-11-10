<!-- Switches per day against the person's own usual range for the window. -->
<script lang="ts">
	import type { DayKey, Insights } from '#lib/app/app.svelte.ts';
	import { dayLabel, spent } from '#lib/ui/format.ts';
	import Card from './Card.svelte';
	import Days from './Days.svelte';
	import { niceAxis } from './scale';

	let {
		data,
		today,
		selected = $bindable(null),
		onopen
	}: {
		data: Insights;
		today: DayKey;
		selected?: DayKey | null;
		onopen: (day: DayKey) => void;
	} = $props();

	const H = 168;
	const points = $derived(data.series);
	const base = $derived(data.baseline);
	const axis = $derived(niceAxis(Math.max(...points.map((p) => p.switches), base?.hi ?? 0, 4)));
	const y = (v: number) => H - (v / axis.max) * H;
	const tracked = $derived(points.filter((p) => p.tracked));
	const total = $derived(points.reduce((n, p) => n + p.switches, 0));
	const r = Math.round;

	function place(v: number): 'above' | 'within' | 'below' | null {
		if (!base) return null;
		return v > base.hi ? 'above' : v < base.lo ? 'below' : 'within';
	}
	const words = { above: 'above', within: 'within', below: 'below' } as const;
	const point = $derived(selected ? points.find((p) => p.day === selected) : undefined);
</script>

<Card
	title="switches per day"
	area="switches"
	meta={base ? `your usual ${r(base.median)}` : undefined}
>
	<p class="readout" aria-live="polite">
		{#if point}
			<b>{dayLabel(point.day)}{point.day === today ? ', so far' : ''}</b> ·
			{#if point.tracked}
				<b>{point.switches}</b> switches · {spent(point.focusMs)} focused
				{#if place(point.switches) && point.day !== today}
					· {words[place(point.switches)!]} your usual range
				{/if}
			{:else}
				nothing tracked
			{/if}
		{:else if base}
			your usual day has <b>{r(base.median)}</b> switches; the middle half of your days fall between
			<b>{r(base.lo)}</b>
			and <b>{r(base.hi)}</b>.
		{:else if tracked.length}
			<b>{total}</b> switches over {tracked.length} tracked {tracked.length === 1 ? 'day' : 'days'}.
			your usual range shows up after 5 full days.
		{:else}
			nothing tracked in these days yet.
		{/if}
	</p>

	<div class="yaxis">
		<div class="grid" style:height="{H}px" aria-hidden="true">
			{#each axis.ticks as t (t)}
				<div class="gridline" style:top="{y(t)}px"><span>{t}</span></div>
			{/each}
			{#if base}
				<div
					class="band"
					style:top="{y(base.hi)}px"
					style:height="{Math.max(2, y(base.lo) - y(base.hi))}px"
				></div>
				<div class="median" style:top="{y(base.median)}px"></div>
			{/if}
		</div>
		<Days
			days={points.map((p) => p.day)}
			bind:selected
			label="Switches per day"
			height={H}
			{onopen}
		>
			{#snippet col(i)}
				{@const p = points[i]}
				<div class="clip">
					{#if p.tracked}
						<div
							class="bar {p.day === today ? 'today' : (place(p.switches) ?? 'within')}"
							style:--v={p.switches / axis.max}
							style:--i={i}
						></div>
					{:else}
						<div class="none"></div>
					{/if}
				</div>
			{/snippet}
		</Days>
	</div>

	<div class="legend" aria-hidden="true">
		{#if base}
			<span><i class="sw above"></i>above your usual range</span>
			<span><i class="sw within"></i>within it</span>
			<span><i class="sw below"></i>below it</span>
			<span><i class="sw band-sw"></i>your middle half of days</span>
		{/if}
		<span><i class="sw today"></i>today, so far</span>
	</div>

	<table class="visually-hidden">
		<caption>Switches per day</caption>
		<thead><tr><th>day</th><th>switches</th></tr></thead>
		<tbody>
			{#each tracked as p (p.day)}
				<tr><td>{dayLabel(p.day)}</td><td>{p.switches}</td></tr>
			{/each}
		</tbody>
	</table>
</Card>

<style>
	.band {
		position: absolute;
		left: 0;
		right: 0;
		background: var(--rule-2);
		border-radius: 2px;
	}
	.median {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--ink-3);
	}
	.bar {
		position: absolute;
		left: 50%;
		bottom: 0;
		width: min(24px, calc(100% - 2px));
		height: 100%;
		border-radius: 4px 4px 0 0;
		background: var(--ink-3);
		transform: translateX(-50%) translateY(calc((1 - var(--v)) * 100%));
		transition: transform 0.5s var(--snap);
		animation: rise 0.7s var(--snap) both;
		animation-delay: calc(var(--i) * 6ms);
	}
	.bar.above {
		background: var(--ink);
	}
	.bar.below {
		background: var(--ink-4);
	}
	.bar.today {
		background: repeating-linear-gradient(135deg, var(--ink-3) 0 2px, transparent 2px 5px);
		box-shadow: inset 0 2px 0 var(--ink-3);
	}
	.none {
		position: absolute;
		left: 50%;
		bottom: 0;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--ink-4);
		transform: translateX(-50%);
	}
	:global(.col.on) .bar {
		background: var(--ink);
	}
	.sw {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 3px;
	}
	.sw.above {
		background: var(--ink);
	}
	.sw.within {
		background: var(--ink-3);
	}
	.sw.below {
		background: var(--ink-4);
	}
	.sw.band-sw {
		background: var(--rule);
	}
	.sw.today {
		background: repeating-linear-gradient(135deg, var(--ink-3) 0 2px, transparent 2px 4px);
		outline: 1px solid var(--ink-3);
		outline-offset: -1px;
	}
</style>
