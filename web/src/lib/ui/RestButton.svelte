<script lang="ts">
	import Iris from './Iris.svelte';
	import { useCtx } from './watch.svelte';

	let { hint = false }: { hint?: boolean } = $props();

	const { app, watch } = useCtx();
	const resting = $derived(app.today.view.state.focus.k === 'rest');
</script>

<button
	class="rest"
	class:on={resting}
	aria-pressed={resting}
	onclick={() => watch.act({ k: 'rest' })}
>
	<Iris size={32} open={resting} />
	<span>rest</span>
	{#if hint}<kbd>r</kbd>{/if}
</button>

<style>
	.rest {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		height: 50px;
		padding: 0 20px 0 8px;
		border-radius: 99px;
		background: var(--panel);
		border: 1px solid var(--rule);
		box-shadow: var(--shadow);
		font-weight: 520;
		transition:
			transform 0.35s var(--spring),
			background-color 0.3s,
			color 0.3s;
	}
	.rest:active {
		transform: scale(0.95);
	}
	.rest.on {
		background: var(--ink);
		color: var(--bg);
	}
	kbd {
		border-color: currentColor;
		opacity: 0.55;
	}
</style>
