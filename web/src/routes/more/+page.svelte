<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '#lib/ui/Icon.svelte';
	import { DESTINATIONS } from '#lib/ui/nav.ts';
</script>

<svelte:head><title>more · heimdall</title></svelte:head>

<h1 class="label">more</h1>
<ul>
	{#each DESTINATIONS.filter((d) => !d.tab) as d (d.path)}
		<li>
			<a href={resolve(d.path)}>
				<Icon d={d.icon} />
				<span>{d.label}</span>
				<svg class="go" viewBox="0 0 16 16" aria-hidden="true"
					><path d="M6 3.5L10.5 8 6 12.5" /></svg
				>
			</a>
		</li>
	{/each}
</ul>

<style>
	h1 {
		padding: 18px 2px 10px;
		font-weight: 400;
	}
	ul {
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	a {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 56px;
		padding: 0 6px;
		border-bottom: 1px solid var(--rule-2);
		font-size: 15.5px;
		text-decoration: none;
	}
	a :global(svg) {
		color: var(--ink-2);
	}
	.go {
		width: 16px;
		height: 16px;
		margin-left: auto;
		fill: none;
		stroke: var(--ink-3);
		stroke-width: 1.5;
	}
</style>
