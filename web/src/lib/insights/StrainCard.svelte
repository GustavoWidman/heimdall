<!--
	Check-in strain and stress on the same days as switching, with headache days marked.
	Three stacked plots on one shared row of days, each with its own scale: they sit side by
	side to be looked at together, and the card says nothing about cause.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { DayKey, Insights } from '#lib/app/app.svelte.ts';
	import { dayLabel } from '#lib/ui/format.ts';
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

	const SW = 56;
	const ACHE = 22;
	const SCALE = 96;
	const GAP = 10;
	const H = SW + GAP + ACHE + GAP + SCALE;

	const points = $derived(data.series);
	const axis = $derived(niceAxis(Math.max(...points.map((p) => p.switches), 4), 3));
	const answered = $derived(points.filter((p) => p.strain !== null || p.stress !== null));
	const tracked = $derived(points.filter((p) => p.tracked).length);
	const point = $derived(selected ? points.find((p) => p.day === selected) : undefined);
	/** Top of the 1..5 scale area, and where a value sits in it. */
	const s0 = SW + GAP + ACHE + GAP;
	const sy = (v: number) => s0 + SCALE - ((v - 1) / 4) * (SCALE - 8) - 4;

	const LEVEL = ['not at all', 'a little', 'somewhat', 'quite', 'very'];
	const ACHES = ['none', 'mild', 'moderate', 'severe'];
</script>

<Card title="strain next to switching" area="strain" meta="shown together, not as cause">
	<p class="readout" aria-live="polite">
		{#if point}
			<b>{dayLabel(point.day)}</b> ·
			{#if point.tracked}<b>{point.switches}</b> switches{:else}nothing tracked{/if}
			·
			{#if point.strain !== null || point.stress !== null}
				strain <b>{point.strain ?? '–'}</b>{point.strain ? ` (${LEVEL[point.strain - 1]})` : ''} · stress
				<b>{point.stress ?? '–'}</b>
				{#if point.headache}· headache <b>{ACHES[point.headache]}</b>{/if}
			{:else}
				no check-in
			{/if}
		{:else if answered.length}
			{answered.length} of {points.length} days have a check-in. strain and stress (1 to 5) sit under
			each day's switches so they can be read together.
		{:else}
			no check-ins in these {points.length} days.
		{/if}
	</p>

	<div class="yaxis">
		<div class="grid" style:height="{H}px" aria-hidden="true">
			<div class="gridline" style:top="0px"><span>{axis.max}</span></div>
			<div class="gridline base" style:top="{SW}px"><span>0</span></div>
			{#each [1, 3, 5] as v (v)}
				<div class="gridline" style:top="{sy(v)}px"><span>{v}</span></div>
			{/each}
		</div>
		<Days
			days={points.map((p) => p.day)}
			bind:selected
			label="Switches, strain, stress, and headache per day"
			height={H}
			{onopen}
		>
			{#snippet col(i)}
				{@const p = points[i]}
				<div class="clip" style:height="{SW}px">
					{#if p.tracked}
						<div
							class="bar"
							class:today={p.day === today}
							style:--v={p.switches / axis.max}
							style:--i={i}
						></div>
					{/if}
				</div>
				{#if p.headache}
					<i class="ache" style:top="{SW + GAP + ACHE / 2}px" style:--s={p.headache}></i>
				{/if}
				{#if p.stress !== null}
					<i class="dash" style:top="{sy(p.stress)}px" style:--i={i}></i>
				{/if}
				{#if p.strain !== null}
					<i class="dot" style:top="{sy(p.strain)}px" style:--i={i}></i>
				{/if}
			{/snippet}
		</Days>
		{#if !answered.length}
			<div class="nothing" style:top="{s0}px" style:height="{SCALE}px">
				<p>
					answer the <a href={resolve('/checkin')}>check-in</a> on a few evenings and strain shows up
					here, next to that day's switching.
				</p>
			</div>
		{/if}
	</div>

	<div class="legend" aria-hidden="true">
		<span><i class="key bar-key"></i>switches</span>
		<span><i class="key strain"></i>strain</span>
		<span><i class="key stress"></i>stress</span>
		<span><i class="key ache-key"></i>headache, larger when worse</span>
	</div>

	<div class="visually-hidden">
		<table>
			<caption
				>Switches, strain, stress, and headache on days with a check-in, out of {tracked} tracked days</caption
			>
			<thead
				><tr><th>day</th><th>switches</th><th>strain</th><th>stress</th><th>headache</th></tr
				></thead
			>
			<tbody>
				{#each answered as p (p.day)}
					<tr>
						<td>{dayLabel(p.day)}</td><td>{p.switches}</td><td>{p.strain ?? ''}</td><td
							>{p.stress ?? ''}</td
						><td>{p.headache === null ? '' : ACHES[p.headache]}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Card>

<style>
	.gridline.base {
		border-top-color: var(--rule);
	}
	.bar {
		position: absolute;
		left: 50%;
		bottom: 0;
		width: min(24px, calc(100% - 2px));
		height: 100%;
		border-radius: 3px 3px 0 0;
		background: var(--ink-4);
		transform: translateX(-50%) translateY(calc((1 - var(--v)) * 100%));
		transition: transform 0.5s var(--snap);
		animation: rise 0.7s var(--snap) both;
		animation-delay: calc(var(--i) * 6ms);
	}
	.bar.today {
		background: repeating-linear-gradient(135deg, var(--ink-4) 0 2px, transparent 2px 5px);
	}
	:global(.col.on) .bar {
		background: var(--ink-2);
	}
	.dot {
		position: absolute;
		left: 50%;
		width: min(9px, calc(100% + 1px));
		aspect-ratio: 1;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		animation: pop 0.5s var(--spring) both;
		animation-delay: calc(200ms + var(--i) * 6ms);
	}
	.dot {
		background: var(--ink);
		box-shadow: 0 0 0 2px var(--panel);
	}
	.dash {
		position: absolute;
		left: 50%;
		width: min(16px, calc(100% + 2px));
		height: 2px;
		border-radius: 1px;
		background: var(--ink-3);
		transform: translate(-50%, -50%);
		pointer-events: none;
		animation: pop 0.5s var(--spring) both;
		animation-delay: calc(150ms + var(--i) * 6ms);
	}
	.ache {
		position: absolute;
		left: 50%;
		width: calc(3px + var(--s) * 2.5px);
		aspect-ratio: 1;
		background: var(--ink-2);
		border-radius: 1.5px;
		transform: translate(-50%, -50%) rotate(45deg);
		pointer-events: none;
	}
	.nothing {
		position: absolute;
		left: 0;
		right: 0;
		display: grid;
		place-items: center;
		padding: 0 12px;
		border: 1px solid var(--rule-2);
		border-radius: 10px;
		background: color-mix(in srgb, var(--panel) 85%, transparent);
	}
	.nothing p {
		max-width: 34ch;
		text-align: center;
		font-size: 13px;
		color: var(--ink-2);
	}
	.key {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.key.bar-key {
		border-radius: 3px;
		background: var(--ink-4);
	}
	.key.strain {
		background: var(--ink);
	}
	.key.stress {
		width: 12px;
		height: 2px;
		border-radius: 1px;
		background: var(--ink-3);
	}
	.key.ache-key {
		width: 8px;
		height: 8px;
		border-radius: 1.5px;
		background: var(--ink-2);
		transform: rotate(45deg);
	}
</style>
