<script lang="ts">
	import { resolve } from '$app/paths';
	import { summarize } from '#lib/checkin/view.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Version from '#lib/ui/Version.svelte';
	import { DESTINATIONS, type Destination } from '#lib/ui/nav.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	const { app } = useCtx();

	const ORDER: readonly (readonly Destination['path'][])[] = [
		['/tasks', '/checkin'],
		['/week', '/month', '/year'],
		['/settings']
	];
	const byPath = new Map(DESTINATIONS.map((d) => [d.path, d]));

	const active = $derived(app.tasks.filter((t) => t.status === 'active').length);
	const checkIn = $derived(summarize(app.today.checkIn));
	const ABOUT: Partial<Record<Destination['path'], () => string>> = {
		'/tasks': () => (active ? `${active} active` : 'the backlog and deadlines'),
		'/checkin': () =>
			checkIn ? `today: ${checkIn.answered} of ${checkIn.of} answered` : 'how the day felt',
		'/week': () => 'seven days side by side',
		'/month': () => 'the month at a glance',
		'/year': () => 'every day of the year',
		'/settings': () => 'theme, days, sync, export'
	};
</script>

<svelte:head><title>more · heimdall</title></svelte:head>

<h1 class="label">more</h1>
{#each ORDER as group, i (i)}
	<ul>
		{#each group as path (path)}
			{@const d = byPath.get(path)}
			{#if d}
				<li>
					<a href={resolve(d.path)}>
						<Icon d={d.icon} />
						<span class="what">
							<span>{d.label}</span>
							<span class="about">{ABOUT[d.path]?.()}</span>
						</span>
						<svg class="go" viewBox="0 0 16 16" aria-hidden="true"
							><path d="M6 3.5L10.5 8 6 12.5" /></svg
						>
					</a>
				</li>
			{/if}
		{/each}
	</ul>
{/each}
<Version />

<style>
	h1 {
		padding: 18px 2px 10px;
		font-weight: 400;
	}
	ul {
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	ul + ul {
		margin-top: 22px;
	}
	a {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 60px;
		padding: 8px 6px;
		border-bottom: 1px solid var(--rule-2);
		font-size: 15.5px;
		text-decoration: none;
		transition: background-color 0.2s;
	}
	a:active {
		background: var(--panel-2);
	}
	a :global(svg) {
		color: var(--ink-2);
	}
	.what {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.about {
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.go {
		width: 16px;
		height: 16px;
		margin-left: auto;
		fill: none;
		stroke: var(--ink-3);
		stroke-width: 1.5;
	}

	@media (min-width: 1000px) {
		h1,
		ul {
			max-width: 560px;
			margin-inline: auto;
		}
		ul + ul {
			margin-top: 22px;
		}
	}
</style>
