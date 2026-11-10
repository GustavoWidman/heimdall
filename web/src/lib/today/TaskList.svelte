<!--
	Today's board. Rows stay where they were put. "arrange" turns rows into editors with
	move controls, and on a desktop they can also be dragged.
-->
<script lang="ts">
	import { flip } from 'svelte/animate';
	import type { BoardRow, Task, TaskId } from '#lib/app/app.svelte.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import TaskRow from './TaskRow.svelte';

	let {
		rows,
		onedit,
		onadd
	}: {
		rows: readonly BoardRow[];
		onedit: (task: Task) => void;
		onadd: () => void;
	} = $props();

	const { app, watch } = useCtx();
	const focus = $derived(app.today.view.state.focus);
	const juggling = $derived(focus.k === 'working' && focus.tasks.length > 1);
	const planned = $derived(rows.filter((r) => r.planned));

	let arranging = $state(false);
	let dragging: TaskId | null = $state(null);
	let over: TaskId | null = $state(null);

	function move(task: TaskId, by: -1 | 1) {
		const i = planned.findIndex((r) => r.task.id === task);
		const j = i + by;
		if (i < 0 || j < 0 || j >= planned.length) return;
		const before = by < 0 ? planned[j].task.id : (planned[j + 1]?.task.id ?? null);
		app.do({ k: 'reorder', day: app.today.day, task, before });
	}

	function drop(target: TaskId) {
		const from = planned.findIndex((r) => r.task.id === dragging);
		const to = planned.findIndex((r) => r.task.id === target);
		if (dragging && from >= 0 && to >= 0 && from !== to) {
			const before = from < to ? (planned[to + 1]?.task.id ?? null) : target;
			app.do({ k: 'reorder', day: app.today.day, task: dragging, before });
		}
		dragging = null;
		over = null;
	}
</script>

<section class="tasks" aria-label="today's watch">
	<div class="head">
		<h2 class="label">today’s watch</h2>
		<span class="label count">{rows.length} {rows.length === 1 ? 'task' : 'tasks'}</span>
		<button class="tool" aria-pressed={arranging} onclick={() => (arranging = !arranging)}>
			{arranging ? 'done' : 'arrange'}
		</button>
		<button class="tool add" onclick={onadd} aria-keyshortcuts="n">
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>add
		</button>
	</div>

	<ul class="list" class:arranging>
		{#each rows as r, i (r.task.id)}
			<li
				animate:flip={{ duration: 280 }}
				class:over={over === r.task.id && dragging !== r.task.id}
				class:lifted={dragging === r.task.id}
				draggable={arranging && r.planned}
				ondragstart={(e) => {
					dragging = r.task.id;
					e.dataTransfer?.setData('text/plain', r.task.id);
				}}
				ondragover={(e) => {
					if (!dragging || !r.planned) return;
					e.preventDefault();
					over = r.task.id;
				}}
				ondrop={(e) => {
					e.preventDefault();
					drop(r.task.id);
				}}
				ondragend={() => {
					dragging = null;
					over = null;
				}}
			>
				<TaskRow
					row={r}
					index={i}
					juggled={juggling && r.inFocus}
					{arranging}
					onpress={(mode) => watch.press(r.task.id, mode)}
					onedit={() => onedit(r.task)}
				/>
				{#if arranging}
					<span class="mover">
						{#if r.planned}
							<button
								aria-label="move {r.task.title} up"
								disabled={planned[0]?.task.id === r.task.id}
								onclick={() => move(r.task.id, -1)}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
							</button>
							<button
								aria-label="move {r.task.title} down"
								disabled={planned.at(-1)?.task.id === r.task.id}
								onclick={() => move(r.task.id, 1)}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
							</button>
						{:else}
							<button
								class="plan"
								onclick={() => app.do({ k: 'plan', day: app.today.day, task: r.task.id })}
							>
								plan
							</button>
						{/if}
					</span>
				{/if}
			</li>
		{/each}
	</ul>

	<p class="hint label">
		{arranging ? 'tap a task to edit it' : 'tap to switch · hold to juggle'}
	</p>
</section>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 0 4px 2px;
	}
	h2 {
		font-weight: 400;
	}
	.count {
		margin-right: auto;
		padding-left: 8px;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 44px;
		min-width: 44px;
		padding: 0 10px;
		border-radius: 99px;
		font-size: 13px;
		color: var(--ink-2);
	}
	.tool[aria-pressed='true'] {
		color: var(--ink);
		font-weight: 560;
	}
	.tool svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
	}
	.list {
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	li {
		position: relative;
		border-bottom: 1px solid var(--rule-2);
	}
	.arranging li {
		padding-right: 96px;
	}
	.arranging li[draggable='true'] {
		cursor: grab;
	}
	li.lifted {
		opacity: 0.4;
	}
	li.over {
		box-shadow: inset 0 2px 0 var(--ink);
	}
	.mover {
		position: absolute;
		top: 50%;
		right: 0;
		display: flex;
		gap: 4px;
		transform: translateY(-50%);
	}
	.mover button {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 1px solid var(--rule);
		border-radius: 12px;
		transition:
			transform 0.25s var(--spring),
			opacity 0.2s;
	}
	.mover button:active {
		transform: scale(0.92);
	}
	.mover button:disabled {
		opacity: 0.3;
	}
	.mover button.plan {
		width: auto;
		padding: 0 14px;
		font-size: 13px;
	}
	.mover svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.hint {
		margin-top: 10px;
		text-align: center;
	}

	@media (min-width: 1000px) {
		.list {
			display: grid;
			grid-template-columns: 1fr 1fr;
			column-gap: 22px;
			border-top: 0;
		}
		.list li:nth-child(-n + 2) {
			border-top: 1px solid var(--rule);
		}
		.hint {
			text-align: left;
			padding-left: 4px;
		}
	}
</style>
