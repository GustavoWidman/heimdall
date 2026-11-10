<!--
	Tally marks in groups of five, as in the notebook. A mark added while on screen is
	drawn as a pen stroke in the task's hue.
-->
<script lang="ts">
	import { untrack } from 'svelte';

	let {
		count,
		hue,
		seed,
		live = true
	}: {
		count: number;
		hue: number;
		seed: string;
		/** The newest mark keeps its hue only while it is the latest tick anywhere. */
		live?: boolean;
	} = $props();

	const MAX = 20;
	const GROUP_W = 20;

	const arrived = untrack(() => count);
	const shown = $derived(Math.min(count, MAX));
	const fresh = $derived(live && count > arrived && count <= MAX ? count - 1 : -1);
	const width = $derived(Math.max(0, Math.ceil(shown / 5) * GROUP_W - 5));

	/** A steady hand with a little wobble, the same for a mark on every render. */
	function jitter(i: number): number {
		let h = i * 2654435761;
		for (let c = 0; c < seed.length; c++) h = Math.imul(h ^ seed.charCodeAt(c), 16777619);
		return ((h >>> 0) % 1000) / 1000 - 0.5;
	}

	function stroke(i: number): string {
		const x0 = Math.floor(i / 5) * GROUP_W;
		const j = jitter(i);
		if (i % 5 === 4) return `M${x0 - 1} ${10.5 + j} Q${x0 + 7} ${7 - j} ${x0 + 14.5} ${2.5 + j}`;
		const x = x0 + 1.5 + (i % 5) * 3.6;
		return `M${x + j * 0.8} 1.5 Q${x - j * 0.6} 7 ${x - j * 0.3} 12.5`;
	}
</script>

<span class="tally" role="img" aria-label="{count} {count === 1 ? 'tick' : 'ticks'}">
	{#if shown > 0}
		<svg viewBox="-2 0 {width + 3} 14" width={width + 3} height="14" aria-hidden="true">
			{#each { length: shown }, i (i)}
				<path
					d={stroke(i)}
					pathLength="1"
					class:fresh={i === fresh}
					class:hue={i === fresh}
					style:--h={i === fresh ? hue : null}
				/>
			{/each}
		</svg>
	{/if}
	{#if count > MAX}<span class="more mono">+{count - MAX}</span>{/if}
</span>

<style>
	.tally {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 14px;
	}
	svg {
		overflow: visible;
	}
	path {
		fill: none;
		stroke: var(--tally-ink, var(--ink-2));
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	path.fresh {
		stroke: var(--c);
		stroke-width: 1.7;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: draw 0.45s cubic-bezier(0.6, 0, 0.3, 1) 0.12s forwards;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	.more {
		font-size: 10.5px;
		color: var(--ink-3);
	}
</style>
