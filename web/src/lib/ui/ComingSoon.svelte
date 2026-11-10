<!-- A calm stand-in for a screen that is not built yet, so navigation already works. -->
<script lang="ts">
	import Iris from './Iris.svelte';

	let { title, about }: { title: string; about: string } = $props();
</script>

<svelte:head><title>{title} · heimdall</title></svelte:head>

<section class="soon">
	<Iris size={64} />
	<h1>{title}</h1>
	<p>{about}</p>
	<p class="label">coming soon</p>
</section>

<style>
	.soon {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		max-width: 340px;
		margin: 18vh auto 0;
		text-align: center;
	}
	h1 {
		margin-top: 8px;
		font-size: 22px;
		font-weight: 560;
		letter-spacing: -0.02em;
	}
	p {
		color: var(--ink-2);
		font-size: 14px;
	}
</style>
