<!--
	Deadlines still ahead and those that fell in the window, and how much of each task's time
	came in the last day and the last three hours before it.
-->
<script lang="ts">
	import type { DeadlinePressure, Task, TaskId } from '#lib/app/app.svelte.ts';
	import { clock, dayLabel, spent } from '#lib/ui/format.ts';
	import Card from './Card.svelte';

	let {
		deadlines,
		all,
		zone,
		days
	}: {
		deadlines: readonly DeadlinePressure[];
		all: readonly Task[];
		zone: string;
		days: number;
	} = $props();

	const byId = $derived(new Map<TaskId, Task>(all.map((t) => [t.id, t])));
	const date = $derived(new Intl.DateTimeFormat('en-CA', { timeZone: zone }));
	const due = (at: number) => `${dayLabel(date.format(at))}, ${clock(at, zone)}`;
	const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);
</script>

<Card title="deadline pressure" area="deadlines" meta="time in the hours before each deadline">
	{#if deadlines.length}
		<ol>
			{#each deadlines as d, i (d.task)}
				{@const task = byId.get(d.task)}
				{@const earlier = Math.max(0, d.ms - d.msLast24h)}
				{@const day = Math.max(0, d.msLast24h - d.msLast3h)}
				<li class="hue" style:--h={task?.hue ?? 0} style:--i={i}>
					<div class="head">
						<span class="title"><i class="dot"></i>{task?.title ?? 'a task'}</span>
						<span class="label">due {due(d.deadline)}</span>
					</div>
					{#if d.ms > 0}
						<div
							class="bar"
							role="img"
							aria-label="{spent(earlier)} earlier, {spent(day)} in the last day, {spent(
								d.msLast3h
							)} in the last 3 hours"
						>
							{#if earlier > 0}<i class="part earlier" style:flex-grow={earlier}></i>{/if}
							{#if day > 0}<i class="part day" style:flex-grow={day}></i>{/if}
							{#if d.msLast3h > 0}<i class="part last" style:flex-grow={d.msLast3h}></i>{/if}
						</div>
						<p class="about">
							<b>{spent(d.ms)}</b> on it {d.upcoming ? 'so far' : 'in these days'}.
							<b>{pct(d.msLast24h, d.ms)}%</b>
							came in the last 24 hours, <b>{spent(d.msLast3h)}</b> in the last 3.
						</p>
					{:else}
						<p class="about">no time on it {d.upcoming ? 'yet' : 'in these days'}.</p>
					{/if}
				</li>
			{/each}
		</ol>
		<div class="legend" aria-hidden="true">
			<span><i class="key earlier"></i>earlier</span>
			<span><i class="key day"></i>last 24 hours</span>
			<span><i class="key last"></i>last 3 hours</span>
		</div>
	{:else}
		<p class="quiet">no deadlines in the last {days} days, and none in the next {days}.</p>
	{/if}
</Card>

<style>
	ol {
		list-style: none;
	}
	li {
		padding: 12px 0;
		border-top: 1px solid var(--rule-2);
		animation: settle 0.45s var(--snap) both;
		animation-delay: calc(var(--i) * 40ms);
	}
	li:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		font-size: 14.5px;
	}
	.head .label {
		flex: none;
	}
	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
	}
	.bar {
		display: flex;
		gap: 2px;
		height: 8px;
		margin: 10px 0 8px;
	}
	.part {
		min-width: 3px;
		border-radius: 4px;
		background: var(--c);
	}
	.earlier {
		background: var(--c-soft);
	}
	.day {
		background: color-mix(in oklab, var(--c) 55%, var(--c-soft));
	}
	.about {
		font-size: 13px;
		color: var(--ink-2);
	}
	.about b {
		font-weight: 560;
		color: var(--ink);
	}
	.key {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 3px;
		border: 1px solid var(--rule);
	}
	.key.earlier {
		background: color-mix(in oklab, var(--ink) 12%, var(--panel));
	}
	.key.day {
		background: color-mix(in oklab, var(--ink) 45%, var(--panel));
	}
	.key.last {
		background: var(--ink);
	}
	.quiet {
		font-size: 14px;
		color: var(--ink-2);
	}
</style>
