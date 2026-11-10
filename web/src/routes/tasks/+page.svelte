<script lang="ts">
	import type { Task } from '#lib/app/app.svelte.ts';
	import { backlog } from '#lib/tasks/backlog.ts';
	import TaskSheet from '#lib/today/TaskSheet.svelte';
	import { clock, dayLabel, deadlineLabel, remaining } from '#lib/ui/format.ts';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	const { app } = useCtx();
	const now = $derived(Math.floor(app.now / 60_000) * 60_000);
	const zone = $derived(app.settings.timeZone);
	const b = $derived(backlog(app.tasks, now));
	const onToday = $derived(new Set(app.today.board.filter((r) => r.planned).map((r) => r.task.id)));

	let open = $state(false);
	let editing: Task | null = $state(null);
	let showDone = $state(false);
	let showArchived = $state(false);

	function edit(t: Task | null) {
		editing = t;
		open = true;
	}

	const dayOfDeadline = (at: number) =>
		new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at);

	type Group = {
		readonly key: 'active' | 'done' | 'archived';
		readonly title: string;
		readonly tasks: readonly Task[];
	};
	const groups: readonly Group[] = $derived([
		{ key: 'active', title: 'active', tasks: b.active },
		{ key: 'done', title: 'done', tasks: b.done },
		{ key: 'archived', title: 'archived', tasks: b.archived }
	]);
	const folded = (g: Group) =>
		(g.key === 'done' && !showDone) || (g.key === 'archived' && !showArchived);
	function toggle(g: Group) {
		if (g.key === 'done') showDone = !showDone;
		if (g.key === 'archived') showArchived = !showArchived;
	}
</script>

<svelte:head><title>tasks · heimdall</title></svelte:head>

<div class="tasks">
	<header class="head">
		<h1>tasks</h1>
		<span class="label">{b.active.length} active</span>
		<button class="btn primary new" onclick={() => edit(null)}>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>new task
		</button>
	</header>

	<section class="soon" aria-labelledby="soon-h">
		<h2 class="label" id="soon-h">due in the next 7 days</h2>
		{#if b.soon.length}
			<ol>
				{#each b.soon as t (t.id)}
					{@const d = t.deadline as number}
					<li class="hue" style:--h={t.hue}>
						<button class="due" onclick={() => edit(t)}>
							<span class="when mono">
								<span>{dayLabel(dayOfDeadline(d)).slice(0, 3)}</span>
								<span>{clock(d, zone)}</span>
							</span>
							<span class="dot" aria-hidden="true"></span>
							<span class="t">{t.title}</span>
							<span class="left label">in {remaining(d - now)}</span>
						</button>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="quiet">nothing due this week.</p>
		{/if}
	</section>

	<div class="lists">
		{#each groups as g (g.key)}
			<section class="group" aria-labelledby="g-{g.key}">
				{#if g.key === 'active'}
					<h2 class="label" id="g-{g.key}">{g.title}</h2>
				{:else}
					<button
						class="fold"
						id="g-{g.key}"
						aria-expanded={!folded(g)}
						onclick={() => toggle(g)}
						disabled={g.tasks.length === 0}
					>
						<span class="label">{g.title}</span>
						<span class="label n">{g.tasks.length}</span>
						<svg class:up={!folded(g)} viewBox="0 0 16 16" aria-hidden="true"
							><path d="M3.5 6L8 10.5 12.5 6" /></svg
						>
					</button>
				{/if}

				{#if g.key === 'active' && g.tasks.length === 0}
					<p class="quiet">no tasks yet. add one here, or from today’s board.</p>
				{:else if !folded(g)}
					<ul>
						{#each g.tasks as t (t.id)}
							{@const dl = t.deadline === null ? null : deadlineLabel(t.deadline, now, zone)}
							<li class="row hue" class:quietrow={g.key !== 'active'} style:--h={t.hue}>
								<button class="open" onclick={() => edit(t)}>
									<span class="dot" aria-hidden="true"></span>
									<span class="body">
										<span class="t">{t.title}</span>
										<span class="meta label">
											{#if t.longRunning}<span>long-term</span>{/if}
											{#if dl}<span class:near={dl.near}>{dl.text}</span>{/if}
											{#if onToday.has(t.id)}<span>on today</span>{/if}
										</span>
									</span>
								</button>
								{#if g.key === 'active'}
									{#if !onToday.has(t.id)}
										<button
											class="chip act"
											onclick={() => app.do({ k: 'plan', day: app.today.day, task: t.id })}
											aria-label="put {t.title} on today"
										>
											+ today
										</button>
									{/if}
								{:else}
									<button
										class="chip act"
										onclick={() => app.do({ k: 'editTask', task: t.id, status: 'active' })}
										aria-label="restore {t.title}"
									>
										restore
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</div>
</div>

<Sheet bind:open label="task">
	{#key editing?.id}
		<TaskSheet task={editing} planToday={false} onclose={() => (open = false)} />
	{/key}
</Sheet>

<style>
	.tasks {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-top: 6px;
	}
	h1 {
		font-size: 22px;
		font-weight: 560;
		letter-spacing: -0.02em;
	}
	.new {
		margin-left: auto;
		min-height: 44px;
		padding: 0 14px;
		font-size: 14px;
	}
	.new svg,
	.fold svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	h2 {
		font-weight: 400;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--rule);
	}
	ol,
	ul {
		list-style: none;
	}
	.due {
		display: grid;
		grid-template-columns: 74px 10px 1fr auto;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 44px;
		border-bottom: 1px solid var(--rule-2);
		text-align: left;
	}
	.when {
		display: flex;
		gap: 6px;
		font-size: 12px;
		color: var(--ink-2);
	}
	.when span:first-child {
		width: 24px;
		color: var(--ink-3);
	}
	.dot {
		width: 10px;
		height: 10px;
		flex: none;
		border-radius: 50%;
		background: var(--c);
	}
	.t {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 15px;
	}
	.quiet {
		padding: 14px 0;
		font-size: 13.5px;
		color: var(--ink-3);
	}
	.lists {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.fold {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 44px;
		border-bottom: 1px solid var(--rule);
	}
	.fold:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.fold .n {
		margin-left: auto;
	}
	.fold svg {
		color: var(--ink-3);
		transition: transform 0.35s var(--spring);
	}
	.fold svg.up {
		transform: rotate(180deg);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		border-bottom: 1px solid var(--rule-2);
		animation: arrive 0.3s var(--snap);
	}
	.open {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1;
		min-width: 0;
		min-height: 58px;
		padding: 8px 0;
		text-align: left;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0 10px;
	}
	.meta:empty {
		display: none;
	}
	.meta .near {
		color: var(--c-text);
	}
	.quietrow .t {
		color: var(--ink-2);
	}
	.quietrow .dot {
		background: none;
		box-shadow: inset 0 0 0 1.5px var(--c);
	}
	.act {
		flex: none;
		min-height: 36px;
		padding: 0 12px;
		font-size: 12.5px;
		color: var(--ink-2);
		position: relative;
	}
	.act::after {
		content: '';
		position: absolute;
		inset: -4px;
	}
	@keyframes arrive {
		from {
			opacity: 0;
		}
	}

	@media (min-width: 1000px) {
		.tasks {
			display: grid;
			grid-template-columns: 1fr 380px;
			grid-template-areas: 'head head' 'lists soon';
			column-gap: 56px;
			max-width: 1180px;
			margin: 0 auto;
			padding-top: 16px;
		}
		.head {
			grid-area: head;
		}
		.soon {
			grid-area: soon;
			position: sticky;
			top: 16px;
		}
		.lists {
			grid-area: lists;
		}
	}
</style>
