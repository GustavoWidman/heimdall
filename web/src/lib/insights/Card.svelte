<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		meta,
		area,
		children
	}: { title: string; meta?: string; area: string; children: Snippet } = $props();

	const id = $props.id();
</script>

<section class="card" style:grid-area={area} aria-labelledby={id}>
	<header>
		<h2 class="label" {id}>{title}</h2>
		{#if meta}<span class="label meta">{meta}</span>{/if}
	</header>
	{@render children()}
</section>

<style>
	.card {
		min-width: 0;
		padding: 18px 18px 16px;
		border: 1px solid var(--rule-2);
		border-radius: 16px;
		background: var(--panel);
	}
	header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 2px 12px;
		margin-bottom: 12px;
	}
	h2 {
		white-space: nowrap;
		font-weight: 400;
		color: var(--ink-2);
	}
	.meta {
		color: var(--ink-3);
		opacity: 0.85;
	}

	/* Chart chrome shared by every card. */
	.card :global(.readout) {
		min-height: 40px;
		margin-bottom: 12px;
		font-size: 13.5px;
		line-height: 1.45;
		color: var(--ink-2);
	}
	.card :global(.readout b) {
		font-weight: 560;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
	.card :global(.legend) {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin-top: 12px;
		font-size: 12px;
		color: var(--ink-3);
	}
	.card :global(.legend span) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.card :global(.grid) {
		position: absolute;
		inset: 0 0 auto 0;
		pointer-events: none;
	}
	.card :global(.gridline) {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--rule-2);
	}
	.card :global(.gridline span) {
		position: absolute;
		right: 0;
		top: -7px;
		transform: translateX(calc(100% + 6px));
		font-family: var(--mono);
		font-size: 10px;
		color: var(--ink-3);
	}
	.card :global(.yaxis) {
		position: relative;
		margin-right: 30px;
	}
	.card :global(.clip) {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}
	@keyframes -global-rise {
		from {
			transform: translateX(-50%) translateY(100%);
		}
	}
	@keyframes -global-pop {
		from {
			transform: translate(-50%, -50%) scale(0);
		}
	}
	@keyframes -global-settle {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
</style>
