<!-- A number whose digits roll like a mechanical counter when it changes. -->
<script lang="ts">
	import { onMount } from 'svelte';

	let { value }: { value: number } = $props();

	// Rolls up from zero once on arrival, then follows the value directly.
	let arrived = $state(false);
	onMount(() => {
		requestAnimationFrame(() => (arrived = true));
	});

	const digits = $derived(
		String(Math.max(0, Math.floor(arrived ? value : 0))).padStart(
			String(Math.floor(value)).length,
			'0'
		)
	);
	/** Keyed by place value, so the ones digit keeps its element when a tens digit appears. */
	const places = $derived(
		[...digits].map((d, i) => ({ place: digits.length - 1 - i, digit: Number(d) }))
	);
</script>

<span class="odo mono" aria-label={String(value)} role="img">
	{#each places as p (p.place)}
		<span class="d" aria-hidden="true">
			<span class="strip" style:transform="translateY({-p.digit * 10}%)">
				{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as n (n)}<span>{n}</span>{/each}
			</span>
		</span>
	{/each}
</span>

<style>
	.odo {
		display: inline-flex;
		height: 1.1em;
		line-height: 1.1em;
		overflow: hidden;
	}
	.d {
		display: block;
		width: 0.62em;
		height: 1.1em;
		overflow: hidden;
	}
	.strip {
		display: flex;
		flex-direction: column;
		transition: transform 0.7s var(--spring);
	}
	.strip span {
		height: 1.1em;
		text-align: center;
	}
</style>
