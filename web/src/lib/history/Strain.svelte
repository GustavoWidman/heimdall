<!-- How worn out a day's check-in said it was, as five small pips. Nothing when unanswered. -->
<script lang="ts">
	import { CHECKIN_FIELDS } from '../domain/checkin';

	let { value }: { value: number | undefined } = $props();
	const WORDS = CHECKIN_FIELDS.strain.labels;
</script>

{#if value === undefined}
	<span class="strain none" aria-label="no strain answer">·</span>
{:else}
	<span class="strain" role="img" aria-label="strain {WORDS[value - 1]}">
		{#each { length: 5 }, i (i)}<i class:on={i < value}></i>{/each}
	</span>
{/if}

<style>
	.strain {
		display: inline-flex;
		align-items: flex-end;
		gap: 1.5px;
		height: 12px;
	}
	i {
		width: 3px;
		border-radius: 1px;
		background: var(--rule);
	}
	i:nth-child(1) {
		height: 4px;
	}
	i:nth-child(2) {
		height: 6px;
	}
	i:nth-child(3) {
		height: 8px;
	}
	i:nth-child(4) {
		height: 10px;
	}
	i:nth-child(5) {
		height: 12px;
	}
	i.on {
		background: var(--ink-2);
	}
	.none {
		justify-content: center;
		width: 21px;
		color: var(--ink-4);
	}
</style>
