<!-- Per-task totals, ranked by whichever measure is chosen, each bar in its task's hue. -->
<script lang="ts">
	import type { Task, TaskId, TaskTotals } from '#lib/app/app.svelte.ts';
	import { spent } from '#lib/ui/format.ts';
	import Card from './Card.svelte';

	let { tasks, all }: { tasks: readonly TaskTotals[]; all: readonly Task[] } = $props();

	const HALF_HOUR = 30 * 60_000;
	type Measure = {
		readonly key: string;
		readonly label: string;
		readonly about: string;
		readonly value: (t: TaskTotals) => number;
		readonly text: (t: TaskTotals) => string;
		readonly keep?: (t: TaskTotals) => boolean;
	};
	const MEASURES: readonly Measure[] = [
		{
			key: 'in',
			label: 'into',
			about: 'times you switched into each task',
			value: (t) => t.switchesIn,
			text: (t) => String(t.switchesIn)
		},
		{
			key: 'urge',
			label: 'on urge',
			about: 'times each task was left on a switch tagged urge',
			value: (t) => t.leftByUrge,
			text: (t) => String(t.leftByUrge)
		},
		{
			key: 'time',
			label: 'time',
			about: 'time with each task in focus, juggles counted in full',
			value: (t) => t.ms,
			text: (t) => spent(t.ms)
		},
		{
			key: 'frag',
			label: 'per hour',
			about: 'switches into each task per hour spent on it, for tasks with 30m or more',
			value: (t) => t.switchesPerHour ?? 0,
			text: (t) => (t.switchesPerHour ?? 0).toFixed(1),
			keep: (t) => t.ms >= HALF_HOUR
		}
	];

	let measure = $state<Measure>(MEASURES[0]);
	let more = $state(false);
	const byId = $derived(new Map<TaskId, Task>(all.map((t) => [t.id, t])));
	const rows = $derived(
		tasks
			.filter((t) => (measure.keep ? measure.keep(t) : true) && measure.value(t) > 0)
			.toSorted((a, b) => measure.value(b) - measure.value(a))
	);
	const top = $derived(rows[0] ? measure.value(rows[0]) : 1);
	const shown = $derived(more ? rows : rows.slice(0, 6));
</script>

<Card title="tasks" area="tasks" meta={measure.about}>
	<div class="measures" role="group" aria-label="rank tasks by">
		{#each MEASURES as m (m.key)}
			<button class="chip" aria-pressed={measure === m} onclick={() => (measure = m)}>
				{m.label}
			</button>
		{/each}
	</div>

	{#if rows.length}
		<ol>
			{#each shown as t, i (t.task)}
				{@const task = byId.get(t.task)}
				<li class="hue" style:--h={task?.hue ?? 0} style:--i={i}>
					<span class="name">
						<i class="dot"></i>
						<span class="title">{task?.title ?? 'a task'}</span>
					</span>
					<span class="value mono">{measure.text(t)}</span>
					<span class="track"><i class="fill" style:--v={measure.value(t) / top}></i></span>
					<span class="context mono">
						{spent(t.ms)} · {t.switchesIn} in · {t.leftByUrge} on urge
					</span>
				</li>
			{/each}
		</ol>
		{#if rows.length > 6}
			<button class="more label" onclick={() => (more = !more)}>
				{more ? 'show fewer' : `show all ${rows.length}`}
			</button>
		{/if}
	{:else}
		<p class="quiet">
			{measure.key === 'urge'
				? 'no task was left on a switch tagged urge in these days.'
				: measure.key === 'frag'
					? 'no task had 30 minutes or more in these days.'
					: 'no task time in these days yet.'}
		</p>
	{/if}
</Card>

<style>
	.measures {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 14px;
	}
	.measures .chip {
		min-height: 36px;
		font-size: 13px;
		padding: 0 12px;
	}
	ol {
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 6px 12px;
		padding: 10px 0;
		border-top: 1px solid var(--rule-2);
		animation: settle 0.45s var(--snap) both;
		animation-delay: calc(var(--i) * 35ms);
	}
	li:first-child {
		border-top: 0;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 14.5px;
	}
	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
	}
	.value {
		font-size: 14px;
		text-align: right;
	}
	.track {
		grid-column: 1 / -1;
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
		background: var(--rule-2);
	}
	.fill {
		display: block;
		height: 100%;
		width: 100%;
		border-radius: 3px;
		background: var(--c);
		transform-origin: left;
		transform: scaleX(var(--v));
		transition: transform 0.5s var(--snap);
	}
	.context {
		grid-column: 1 / -1;
		font-size: 11px;
		color: var(--ink-3);
	}
	.more {
		min-height: 44px;
		padding: 0 4px;
	}
	.quiet {
		font-size: 14px;
		color: var(--ink-2);
	}
</style>
