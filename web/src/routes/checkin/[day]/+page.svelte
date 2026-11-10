<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { dayKey } from '#lib/app/app.svelte.ts';
	import CheckInPage from '#lib/checkin/CheckInPage.svelte';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	const { app } = useCtx();
	const day = $derived(dayKey(page.params.day));
</script>

{#if day && day <= app.today.day}
	{#key day}<CheckInPage {day} />{/key}
{:else}
	<p class="none">
		{day ? 'that day has not happened yet.' : 'that is not a day heimdall knows.'}
		<a href={resolve('/checkin')}>today’s check-in</a>
	</p>
{/if}

<style>
	.none {
		margin-top: 20vh;
		text-align: center;
		color: var(--ink-2);
	}
	.none a {
		display: block;
		margin-top: 8px;
	}
</style>
