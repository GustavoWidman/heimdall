<!--
	A camera aperture per task. Open on the task in focus, shut otherwise. Several hues
	share one iris and spin together while juggling. No hues: a neutral iris for rest.
-->
<script lang="ts">
	import { hueColor } from './hue';

	let {
		hues = [],
		open = false,
		size = 30
	}: {
		hues?: readonly number[];
		open?: boolean;
		/** Pixels, or any CSS length. */
		size?: number | string;
	} = $props();

	const juggle = $derived(hues.length > 1);
	const wheel = $derived(
		juggle
			? `conic-gradient(${hues.map((h, i) => `${hueColor(h)} ${(i / hues.length) * 100}% ${((i + 1) / hues.length) * 100}%`).join(',')})`
			: null
	);
</script>

<span
	class="iris hue"
	class:open
	class:juggle
	class:neutral={hues.length === 0}
	style:--s={typeof size === 'number' ? `${size}px` : size}
	style:--h={hues[0] ?? 0}
	style:--wheel={wheel}
	aria-hidden="true"
>
	<span class="in"></span>
	{#each [0, 60, 120, 180, 240, 300] as r (r)}
		<span class="blade" style:--r="{r}deg"><b></b></span>
	{/each}
	<span class="cap">
		{#each [8, 68, 128, 188, 248, 308] as r (r)}
			<i style:--r="{r}deg"></i>
		{/each}
	</span>
	<span class="rim"></span>
</span>

<style>
	.iris {
		--open: 6%;
		position: relative;
		display: block;
		flex: none;
		width: var(--s);
		height: var(--s);
		border-radius: 50%;
		overflow: hidden;
		isolation: isolate;
	}
	.iris.open {
		--open: -36%;
	}
	.in {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background:
			radial-gradient(circle at 50% 50%, #0b0b0c 0 15%, transparent 16%),
			repeating-conic-gradient(
				from 0deg,
				rgb(255 255 255 / 0.18) 0 3deg,
				rgb(0 0 0 / 0.06) 3deg 7deg
			),
			radial-gradient(circle, var(--c) 0 38%, oklch(calc(var(--L) - 0.12) var(--C) var(--h)) 70%);
	}
	.in::after {
		content: '';
		position: absolute;
		left: 52%;
		top: 36%;
		width: 12%;
		height: 12%;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.85);
	}
	.juggle .in {
		background:
			radial-gradient(circle at 50% 50%, #0b0b0c 0 15%, transparent 16%),
			repeating-conic-gradient(
				from 0deg,
				rgb(255 255 255 / 0.18) 0 3deg,
				rgb(0 0 0 / 0.06) 3deg 7deg
			),
			var(--wheel);
		animation: spin 3.2s linear infinite;
	}
	.neutral .in {
		background:
			radial-gradient(circle at 50% 50%, #0b0b0c 0 15%, transparent 16%),
			radial-gradient(circle, var(--ink-4) 0 38%, var(--ink-3) 75%);
	}
	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}
	.blade {
		position: absolute;
		inset: 0;
		transform: rotate(var(--r));
	}
	.blade b {
		position: absolute;
		left: -60%;
		bottom: 50%;
		width: 220%;
		height: 100%;
		background: linear-gradient(180deg, var(--blade-2), var(--blade));
		border-bottom: 1px solid var(--blade-edge);
		transform-origin: 50% 100%;
		transform: rotate(16deg) translateY(var(--open));
		transition: transform 0.55s var(--spring);
	}
	.cap {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: radial-gradient(circle at 50% 50%, var(--blade-2), var(--blade) 70%);
		transition: opacity 0.25s 0.28s;
	}
	.open .cap {
		opacity: 0;
		transition: opacity 0.12s;
	}
	.cap i {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 52%;
		height: 1px;
		margin-top: -0.5px;
		background: var(--blade-edge);
		transform-origin: 0 50%;
		transform: rotate(var(--r)) translateY(calc(var(--s) * 0.07));
	}
	.cap::after {
		content: '';
		position: absolute;
		left: 42%;
		top: 42%;
		width: 16%;
		height: 16%;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px var(--blade-edge);
	}
	.rim {
		position: absolute;
		inset: 0;
		z-index: 2;
		border-radius: 50%;
		box-shadow:
			inset 0 0 0 1.5px var(--c),
			inset 0 0 0 2.5px var(--bg);
		pointer-events: none;
	}
	.neutral .rim {
		box-shadow: inset 0 0 0 1px var(--rule);
	}
</style>
