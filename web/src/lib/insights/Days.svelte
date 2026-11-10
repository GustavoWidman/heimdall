<!--
	A row of day columns that every per-day chart draws into, with one way to read it:
	a mouse hovers a day and clicks to open it; a finger taps once to read a day and again
	to open it; the keyboard moves with the arrows and opens with Enter.
	The selected day is shared, so pointing at a day in one chart lights it in all of them.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { DayKey } from '#lib/app/app.svelte.ts';
	import { dayTicks } from './scale';

	let {
		days,
		selected = $bindable(null),
		label,
		height,
		axis = true,
		ticks,
		onopen,
		col
	}: {
		days: readonly DayKey[];
		selected?: DayKey | null;
		label: string;
		height: number;
		axis?: boolean;
		/** Axis labels by column; the default suits a run of single days. */
		ticks?: ReadonlyMap<number, string>;
		onopen: (day: DayKey) => void;
		col: Snippet<[number]>;
	} = $props();

	const labels = $derived(ticks ?? dayTicks(days));
	let lastPointer = 'mouse';

	function at(e: Event): DayKey | null {
		const el = (e.target as Element | null)?.closest<HTMLElement>('[data-i]');
		return el ? days[Number(el.dataset.i)] : null;
	}

	function onpointermove(e: PointerEvent) {
		lastPointer = e.pointerType;
		if (e.pointerType === 'mouse') selected = at(e) ?? selected;
	}

	function onclick(e: MouseEvent) {
		const day = at(e);
		if (!day) return;
		if (lastPointer === 'mouse' || selected === day) onopen(day);
		else selected = day;
	}

	function onkeydown(e: KeyboardEvent) {
		const i = selected ? days.indexOf(selected) : -1;
		const move = (to: number) => {
			e.preventDefault();
			selected = days[Math.max(0, Math.min(days.length - 1, to))];
		};
		if (e.key === 'ArrowRight') move(i < 0 ? days.length - 1 : i + 1);
		else if (e.key === 'ArrowLeft') move(i < 0 ? days.length - 1 : i - 1);
		else if (e.key === 'Home') move(0);
		else if (e.key === 'End') move(days.length - 1);
		else if (e.key === 'Enter' && selected) {
			e.preventDefault();
			onopen(selected);
		} else if (e.key === 'Escape') selected = null;
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
	class="days"
	role="group"
	tabindex="0"
	aria-label="{label}. Arrow keys move between days, Enter opens one."
	style:--n={days.length}
	{onpointermove}
	onpointerdown={(e) => (lastPointer = e.pointerType)}
	onpointerleave={(e) => e.pointerType === 'mouse' && (selected = null)}
	{onclick}
	{onkeydown}
>
	<div class="cols" style:height="{height}px">
		{#each days as day, i (day)}
			<div class="col" class:on={selected === day} data-i={i}>
				{@render col(i)}
			</div>
		{/each}
	</div>
	{#if axis}
		<div class="axis" aria-hidden="true">
			{#each days as day, i (day)}
				<span class="tick" class:on={selected === day}>{labels.get(i) ?? ''}</span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.days {
		position: relative;
		touch-action: pan-y;
		cursor: pointer;
		border-radius: 8px;
	}
	.cols,
	.axis {
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
	}
	.col {
		position: relative;
		border-radius: 4px;
		transition: background-color 0.15s;
	}
	.col.on {
		background: var(--rule-2);
	}
	.axis {
		margin-top: 6px;
		height: 14px;
	}
	.tick {
		display: flex;
		justify-content: center;
		font-family: var(--mono);
		font-size: 10px;
		color: var(--ink-3);
		white-space: nowrap;
	}
	.tick.on {
		color: var(--ink);
	}
</style>
