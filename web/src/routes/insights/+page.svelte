<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { DayKey, Insights } from '#lib/app/app.svelte.ts';
	import Iris from '#lib/ui/Iris.svelte';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import DeadlinesCard from '#lib/insights/DeadlinesCard.svelte';
	import HeatCard from '#lib/insights/HeatCard.svelte';
	import ReasonsCard from '#lib/insights/ReasonsCard.svelte';
	import Standouts from '#lib/insights/Standouts.svelte';
	import StrainCard from '#lib/insights/StrainCard.svelte';
	import StretchCard from '#lib/insights/StretchCard.svelte';
	import SwitchesCard from '#lib/insights/SwitchesCard.svelte';
	import TasksCard from '#lib/insights/TasksCard.svelte';
	import Tiles from '#lib/insights/Tiles.svelte';

	const { app } = useCtx();

	const WINDOWS = [7, 30, 90] as const;
	type Span = (typeof WINDOWS)[number];
	const KEY = 'heimdall.insights.window';

	function remembered(): Span {
		try {
			const n = Number(localStorage.getItem(KEY));
			return (WINDOWS as readonly number[]).includes(n) ? (n as Span) : 30;
		} catch {
			return 30;
		}
	}

	let span = $state<Span>(remembered());
	let data = $state<{ span: Span; insights: Insights } | null>(null);
	let selected = $state<DayKey | null>(null);
	const today = $derived(app.today.day);
	const loading = $derived(data?.span !== span);

	function choose(n: Span) {
		span = n;
		selected = null;
		try {
			localStorage.setItem(KEY, String(n));
		} catch {
			/* the choice just isn't remembered */
		}
	}

	$effect(() => {
		const n = span;
		void app.today.view.switches;
		void app.tasks;
		let current = true;
		void app.insights(n).then((insights) => {
			if (current) data = { span: n, insights };
		});
		return () => {
			current = false;
		};
	});

	const open = (day: DayKey) => void goto(`${resolve('/history')}/${day}`);
	const empty = $derived(data ? data.insights.series.every((p) => !p.tracked) : false);
</script>

<svelte:head><title>insights · heimdall</title></svelte:head>

<div class="page">
	<header class="top">
		<div class="title">
			<h1>insights</h1>
			<p class="label">the last {span} days</p>
		</div>
		<div class="windows" role="group" aria-label="window">
			{#each WINDOWS as n (n)}
				<button class="chip" aria-pressed={span === n} onclick={() => choose(n)}>
					{n}<span class="unit">d</span>
				</button>
			{/each}
		</div>
	</header>

	{#if data}
		{@const i = data.insights}
		{#if empty}
			<section class="empty">
				<Iris size={64} />
				{#if app.tasks.length === 0}
					<h2>insights grow out of your days.</h2>
					<p>
						tick a few switches on <a href={resolve('/')}>today</a>, and this page starts describing
						where your attention went, and when.
					</p>
				{:else}
					<h2>nothing tracked in the last {data.span} days.</h2>
					<p>a longer window may hold more.</p>
				{/if}
			</section>
		{:else}
			{#key data.span}
				<div class="grid" class:loading aria-busy={loading}>
					<Tiles data={i} {today} />
					<Standouts items={i.standouts} days={data.span} />
					<SwitchesCard data={i} {today} bind:selected onopen={open} />
					<StrainCard data={i} {today} bind:selected onopen={open} />
					<HeatCard heat={i.heat} days={i.series.filter((p) => p.tracked).length} />
					<ReasonsCard data={i} {today} bind:selected onopen={open} />
					<StretchCard data={i} {today} bind:selected onopen={open} />
					<TasksCard tasks={i.tasks} all={app.tasks} />
					<DeadlinesCard
						deadlines={i.deadlines}
						all={app.tasks}
						zone={app.settings.timeZone}
						days={data.span}
					/>
				</div>
			{/key}
		{/if}
	{:else}
		<p class="label wait">reading your days…</p>
	{/if}
</div>

<style>
	.page {
		max-width: 1376px;
		margin: 0 auto;
	}
	.top {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin: 0 calc(-1 * var(--gutter)) 12px;
		padding: calc(var(--safe-top) + 6px) var(--gutter) 10px;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}
	h1 {
		font-size: 22px;
		font-weight: 560;
		letter-spacing: -0.02em;
	}
	.windows {
		display: flex;
		gap: 6px;
	}
	.windows .chip {
		font-family: var(--mono);
		font-variant-numeric: tabular-nums;
		padding: 0 12px;
	}
	.unit {
		margin-left: 1px;
		opacity: 0.6;
	}
	.grid {
		display: grid;
		gap: 12px;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas:
			'tiles'
			'standouts'
			'switches'
			'strain'
			'heat'
			'why'
			'stretch'
			'tasks'
			'deadlines';
		transition: opacity 0.3s;
		animation: settle 0.45s var(--snap) both;
	}
	.grid.loading {
		opacity: 0.55;
	}
	.wait {
		margin-top: 30vh;
		text-align: center;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		max-width: 360px;
		margin: 14vh auto 0;
		text-align: center;
	}
	.empty h2 {
		margin-top: 8px;
		font-size: 18px;
		font-weight: 540;
	}
	.empty p {
		color: var(--ink-2);
		font-size: 14px;
	}
	@media (min-width: 1000px) {
		.top {
			position: static;
			margin: 8px 0 20px;
			padding: 0;
			background: none;
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
		h1 {
			font-size: 26px;
		}
		.grid {
			gap: 16px;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			grid-template-areas:
				'tiles tiles tiles'
				'switches switches standouts'
				'strain strain why'
				'heat heat stretch'
				'tasks tasks deadlines';
		}
	}
</style>
