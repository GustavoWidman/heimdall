<!-- Which release of heimdall this device runs, and a newer one once it has downloaded. -->
<script lang="ts">
	import { update } from '#lib/app/update.svelte.ts';
</script>

<footer class="label">
	heimdall {__HEIMDALL_VERSION__}
	{#if update.ready}
		<button onclick={() => update.apply()}>update ready · reload</button>
	{/if}
</footer>

<style>
	footer {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		margin-top: 28px;
		color: var(--ink-3);
	}
	button {
		min-height: 44px;
		padding: 0 12px;
		color: var(--ink-2);
		text-decoration: underline;
		text-decoration-color: var(--rule);
		text-underline-offset: 3px;
	}
</style>
