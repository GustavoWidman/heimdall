<!--
	Building the day's board. An empty day opens with it: yesterday's unfinished tasks and
	long-running ones are one tap away, and a new task is one line. Later in the day it is
	the way to put anything else on the board.
-->
<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import type { Task } from '#lib/app/app.svelte.ts';
	import { deadlineLabel } from '#lib/ui/format.ts';
	import { freeHue } from '#lib/ui/hue.ts';
	import Iris from '#lib/ui/Iris.svelte';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	let { opening, ondone }: { opening: boolean; ondone: () => void } = $props();

	const { app } = useCtx();
	const today = $derived(app.today);
	const zone = $derived(app.settings.timeZone);
	const onBoard = $derived(today.board.filter((r) => r.planned));
	const offered = $derived(
		new Set([...today.suggestions.carryOver, ...today.suggestions.backlog].map((t) => t.id))
	);
	const others = $derived(
		app.tasks.filter(
			(t) => t.status === 'active' && !offered.has(t.id) && !onBoard.some((r) => r.task.id === t.id)
		)
	);
	const groups = $derived(
		[
			{ title: 'from yesterday', tasks: today.suggestions.carryOver },
			{ title: 'long-running', tasks: today.suggestions.backlog },
			{ title: 'everything else', tasks: others }
		].filter((g) => g.tasks.length > 0)
	);

	let title = $state('');
	let problem: string | null = $state(null);

	function add(e: SubmitEvent) {
		e.preventDefault();
		const d = app.do({
			k: 'createTask',
			title,
			hue: freeHue(app.tasks),
			planFor: today.day
		});
		if (d.ok) {
			title = '';
			problem = null;
		} else problem = d.rejection.problem;
	}

	function plan(t: Task) {
		app.do({ k: 'plan', day: today.day, task: t.id });
	}
</script>

<header>
	<h2>{opening ? 'open the day' : 'add to today'}</h2>
	<p class="sum">
		{#if onBoard.length === 0}
			what is on the watch today?
		{:else}
			{onBoard.length} on today ·
			{onBoard
				.slice(-3)
				.map((r) => r.task.title)
				.join(', ')}
		{/if}
	</p>
</header>

<form class="new" onsubmit={add}>
	<label class="visually-hidden" for="new-task">a new task</label>
	<input
		id="new-task"
		class="field"
		placeholder="a new task"
		autocomplete="off"
		enterkeyhint="done"
		bind:value={title}
		aria-invalid={problem ? true : undefined}
	/>
	<button class="btn primary" disabled={!title.trim()}>add</button>
</form>
{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

{#each groups as g (g.title)}
	<section class="group">
		<h3 class="label">{g.title}</h3>
		<ul>
			{#each g.tasks as t (t.id)}
				<li animate:flip={{ duration: 300 }} out:fade={{ duration: 160 }}>
					<button class="pick hue" style:--h={t.hue} onclick={() => plan(t)}>
						<Iris hues={[t.hue]} size={24} />
						<span class="name">{t.title}</span>
						{#if t.deadline !== null}
							<span class="due mono">{deadlineLabel(t.deadline, app.now, zone).text}</span>
						{/if}
						<svg class="plus" viewBox="0 0 16 16" aria-hidden="true"
							><path d="M8 3v10M3 8h10" /></svg
						>
						<span class="visually-hidden">add to today</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/each}

<div class="acts">
	<button class="btn primary" onclick={ondone}>
		{opening && onBoard.length > 0 ? 'start the day' : 'done'}
	</button>
</div>

<style>
	h2 {
		font-size: 22px;
		font-weight: 560;
		letter-spacing: -0.02em;
	}
	.sum {
		margin-top: 4px;
		overflow: hidden;
		font-size: 13px;
		color: var(--ink-2);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.new {
		display: flex;
		gap: 8px;
		margin-top: 18px;
	}
	.new .btn {
		flex: none;
		min-height: 44px;
		border-radius: 12px;
		transition:
			opacity 0.2s,
			transform 0.25s var(--spring);
	}
	.new .btn:disabled {
		opacity: 0.35;
	}
	.problem {
		margin-top: 6px;
		font-size: 13px;
		color: var(--ink-2);
	}
	.group {
		margin-top: 20px;
	}
	.group ul {
		list-style: none;
		margin-top: 6px;
		border-top: 1px solid var(--rule);
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 52px;
		padding: 6px 4px;
		border-bottom: 1px solid var(--rule-2);
		text-align: left;
	}
	.pick:active {
		background: var(--c-soft);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.due {
		flex: none;
		font-size: 11px;
		color: var(--ink-3);
	}
	.plus {
		flex: none;
		width: 16px;
		height: 16px;
		fill: none;
		stroke: var(--ink-3);
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.acts {
		display: flex;
		margin-top: 22px;
	}
	.acts .btn {
		flex: 1;
	}
</style>
