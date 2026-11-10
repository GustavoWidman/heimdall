<!-- What stands out in the window, in plain words, with the one caveat that covers the page. -->
<script lang="ts">
	import Card from './Card.svelte';

	let { items, days }: { items: readonly string[]; days: number } = $props();
</script>

<Card title="what stands out" area="standouts">
	{#if items.length}
		<ol>
			{#each items as item, i (item)}
				<li style:--i={i}>{item}.</li>
			{/each}
		</ol>
	{:else}
		<p class="quiet">
			nothing clear enough to say about the last {days} days. comparisons appear once there are enough
			days on both sides of them.
		</p>
	{/if}
	<p class="caveat">patterns, not causes. heimdall is not a medical tool.</p>
</Card>

<style>
	ol {
		list-style: none;
		display: grid;
		gap: 0;
	}
	li {
		padding: 10px 0;
		border-top: 1px solid var(--rule-2);
		font-size: 14.5px;
		line-height: 1.45;
		animation: settle 0.5s var(--snap) both;
		animation-delay: calc(var(--i) * 50ms);
	}
	li:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.quiet {
		font-size: 14px;
		color: var(--ink-2);
	}
	.caveat {
		margin-top: 12px;
		padding-top: 10px;
		border-top: 1px solid var(--rule-2);
		font-size: 12px;
		color: var(--ink-3);
	}
</style>
