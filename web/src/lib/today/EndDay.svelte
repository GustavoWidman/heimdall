<!--
	Closes the watch for the day, so a rest left running does not carry into tomorrow.
	Shown only while the watch is on; the toast that follows offers the undo.
-->
<script lang="ts">
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	const { app, watch } = useCtx();
	const on = $derived(app.today.view.state.focus.k !== 'off');
</script>

{#if on}
	<button class="end" onclick={() => watch.act({ k: 'off' })}>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M3 11c2.6 3.4 5.6 5 9 5s6.4-1.6 9-5" />
			<path d="M12 16v3M6.6 14.4l-1.6 2.4M17.4 14.4l1.6 2.4" />
		</svg>
		end the day
	</button>
{/if}

<style>
	.end {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		margin: 10px auto 0;
		padding: 0 16px;
		border-radius: 99px;
		font-size: 13.5px;
		color: var(--ink-3);
		transition:
			color 0.2s,
			background-color 0.2s,
			transform 0.3s var(--spring);
	}
	.end:hover {
		color: var(--ink);
		background: var(--panel-2);
	}
	.end:active {
		transform: scale(0.96);
	}
	svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
</style>
