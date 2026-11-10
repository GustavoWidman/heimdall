<!--
	Small signs of what a day's check-in said: a headache as a zigzag with one peak per step
	of severity, a tear for crying, a smile for laughing. Decorative; the cell's label says it.
-->
<script lang="ts">
	import type { CheckIn } from '#lib/app/app.svelte.ts';

	let { checkIn }: { checkIn: CheckIn } = $props();

	const ache = $derived(checkIn.headache ?? 0);
	const ZIG = [
		'',
		'M1 7l2.5-4 2.5 4',
		'M1 7l2-4 2 4 2-4 2 4',
		'M1 7l1.7-4 1.7 4 1.7-4 1.7 4 1.7-4 1.5 4'
	];
</script>

<span class="marks" aria-hidden="true">
	{#if ache > 0}
		<svg viewBox="0 0 {4 + ache * 3.5} 9" style:width="{4 + ache * 3.5}px"
			><path d={ZIG[ache]} /></svg
		>
	{/if}
	{#if (checkIn.cried ?? 0) > 0}
		<svg viewBox="0 0 8 10" style:width="7px"
			><path d="M4 1.2C5.6 3.6 6.6 5 6.6 6.4a2.6 2.6 0 0 1-5.2 0C1.4 5 2.4 3.6 4 1.2Z" /></svg
		>
	{/if}
	{#if (checkIn.laughed ?? 0) > 0}
		<svg viewBox="0 0 10 10" style:width="9px"
			><path d="M2 4.2a3.4 3.4 0 0 0 6 0M3 2.2v.1M7 2.2v.1" /></svg
		>
	{/if}
</span>

<style>
	.marks {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 10px;
	}
	svg {
		height: 9px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.3;
		stroke-linecap: round;
		stroke-linejoin: round;
		overflow: visible;
	}
</style>
