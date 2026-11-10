<!--
	How long focus lasts before moving on: each day's typical (median) stretch and its longest,
	and below it, how much of the focused time was spent juggling.
-->
<script lang="ts">
	import type { DayKey, Insights } from '#lib/app/app.svelte.ts';
	import { dayLabel, spent } from '#lib/ui/format.ts';
	import Card from './Card.svelte';
	import Days from './Days.svelte';

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

	const H = 132;
	const J = 36;
	const MIN = 60_000;
	const points = $derived(data.series);
	const axis = $derived.by(() => {
		const max = Math.max(...points.map((p) => (p.stretchLongestMs ?? 0) / MIN), 30);
		const step = max <= 60 ? 15 : max <= 120 ? 30 : max <= 240 ? 60 : 120;
		const top = Math.ceil(max / step) * step;
		return { max: top, ticks: Array.from({ length: top / step + 1 }, (_, k) => k * step) };
	});
	const label = (m: number) =>
		m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`;
	const y = (m: number) => H - (m / axis.max) * H;
	const share = (p: (typeof points)[number]) => (p.focusMs > 0 ? p.juggleMs / p.focusMs : 0);
	const point = $derived(selected ? points.find((p) => p.day === selected) : undefined);
	const days = $derived(points.map((p) => p.day));
	const tracked = $derived(points.filter((p) => p.stretchMedianMs !== null));
</script>

<Card title="focus stretches" area="stretch" meta="time on one thing before moving on">
	<p class="readout" aria-live="polite">
		{#if point}
			<b>{dayLabel(point.day)}{point.day === today ? ', so far' : ''}</b> ·
			{#if point.stretchMedianMs !== null}
				typical <b>{spent(point.stretchMedianMs)}</b> · longest
				<b>{spent(point.stretchLongestMs ?? 0)}</b> · juggling
				<b>{Math.round(share(point) * 100)}%</b>
			{:else}
				nothing tracked
			{/if}
		{:else if tracked.length}
			the dot is a day's typical stretch, the bar its longest. below, the share of focused time
			spent juggling.
		{:else}
			no focus stretches in these days yet.
		{/if}
	</p>

	<div class="yaxis">
		<div class="grid" style:height="{H}px" aria-hidden="true">
			{#each axis.ticks as t (t)}
				<div class="gridline" style:top="{y(t)}px"><span>{label(t)}</span></div>
			{/each}
		</div>
		<Days {days} bind:selected label="Focus stretches per day" height={H} axis={false} {onopen}>
			{#snippet col(i)}
				{@const p = points[i]}
				{#if p.stretchLongestMs !== null && p.stretchMedianMs !== null}
					<div class="clip">
						<div class="bar" style:--v={p.stretchLongestMs / MIN / axis.max} style:--i={i}></div>
					</div>
					<i class="dot" style:top="{y(p.stretchMedianMs / MIN)}px" style:--i={i}></i>
				{/if}
			{/snippet}
		</Days>
	</div>

	<div class="yaxis juggle">
		<div class="grid" style:height="{J}px" aria-hidden="true">
			<div class="gridline" style:top="0px"><span>100%</span></div>
			<div class="gridline" style:top="{J}px"><span>0</span></div>
		</div>
		<Days
			{days}
			bind:selected
			label="Share of focused time spent juggling, per day"
			height={J}
			{onopen}
		>
			{#snippet col(i)}
				{@const p = points[i]}
				<div class="clip">
					{#if share(p) > 0}
						<div class="bar juggle" style:--v={share(p)} style:--i={i}></div>
					{/if}
				</div>
			{/snippet}
		</Days>
	</div>

	<div class="legend" aria-hidden="true">
		<span><i class="key dot-key"></i>typical stretch</span>
		<span><i class="key bar-key"></i>longest</span>
		<span><i class="key j-key"></i>juggling share</span>
	</div>

	<div class="visually-hidden">
		<table>
			<caption>Focus stretches per day</caption>
			<thead><tr><th>day</th><th>typical</th><th>longest</th><th>juggling</th></tr></thead>
			<tbody>
				{#each tracked as p (p.day)}
					<tr>
						<td>{dayLabel(p.day)}</td><td>{spent(p.stretchMedianMs ?? 0)}</td><td
							>{spent(p.stretchLongestMs ?? 0)}</td
						><td>{Math.round(share(p) * 100)}%</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Card>

<style>
	.juggle {
		margin-top: 24px;
	}
	.bar {
		position: absolute;
		left: 50%;
		bottom: 0;
		width: min(24px, calc(100% - 2px));
		height: 100%;
		border-radius: 3px 3px 0 0;
		background: var(--rule);
		transform: translateX(-50%) translateY(calc((1 - var(--v)) * 100%));
		transition: transform 0.5s var(--snap);
		animation: rise 0.7s var(--snap) both;
		animation-delay: calc(var(--i) * 6ms);
	}
	.bar.juggle {
		background: var(--ink-3);
	}
	:global(.col.on) .bar {
		background: var(--ink-3);
	}
	:global(.col.on) .bar.juggle {
		background: var(--ink);
	}
	.dot {
		position: absolute;
		left: 50%;
		width: min(9px, calc(100% + 1px));
		aspect-ratio: 1;
		border-radius: 50%;
		background: var(--ink);
		box-shadow: 0 0 0 2px var(--panel);
		transform: translate(-50%, -50%);
		pointer-events: none;
		animation: pop 0.5s var(--spring) both;
		animation-delay: calc(250ms + var(--i) * 6ms);
	}
	.key {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 3px;
	}
	.dot-key {
		border-radius: 50%;
		background: var(--ink);
	}
	.bar-key {
		background: var(--rule);
	}
	.j-key {
		background: var(--ink-3);
	}
</style>
