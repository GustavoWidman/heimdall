<!--
	Create or edit a task: title, color, deadline, long-term, note. An existing task also
	gets its place on today's board, done and archive, and juggling without a long press.
-->
<script lang="ts">
	import type { Instant, Intent, Task } from '#lib/app/app.svelte.ts';
	import { HOUR, toLocalInput } from '#lib/ui/format.ts';
	import { freeHue, PALETTE } from '#lib/ui/hue.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	let {
		task,
		onclose,
		planToday = true
	}: {
		task: Task | null;
		onclose: () => void;
		/** A new task goes on today's board; off, it joins the backlog only. */
		planToday?: boolean;
	} = $props();

	const { app, watch } = useCtx();
	const today = $derived(app.today);
	const planned = $derived(
		task ? today.board.some((r) => r.planned && r.task.id === task.id) : false
	);
	const focus = $derived(today.view.state.focus);
	const held = $derived(focus.k === 'working' && task ? focus.tasks.includes(task.id) : false);
	const juggling = $derived(focus.k === 'working' && focus.tasks.length > 1);

	// The form edits a copy; nothing is written until save.
	// svelte-ignore state_referenced_locally
	const start = task;
	let title = $state(start?.title ?? '');
	let hue = $state<number>(start?.hue ?? freeHue(app.tasks));
	let deadline = $state(start?.deadline != null ? toLocalInput(start.deadline) : '');
	let longRunning = $state(start?.longRunning ?? false);
	let note = $state(start?.note ?? '');
	let problem: { field: string; text: string } | null = $state(null);

	const swatches = $derived(
		(PALETTE as readonly number[]).includes(hue) ? PALETTE : [hue, ...PALETTE]
	);

	function fields() {
		const at = deadline ? new Date(deadline).getTime() : null;
		return {
			hue,
			deadline: at === null || Number.isNaN(at) ? null : at,
			longRunning,
			note: note.trim() ? note : null
		} as const;
	}

	function save(e: SubmitEvent) {
		e.preventDefault();
		const f = fields();
		const intent: Intent = task
			? {
					k: 'editTask',
					task: task.id,
					...(title !== task.title ? { title } : {}),
					...(f.hue !== task.hue ? { hue: f.hue } : {}),
					...(f.deadline !== task.deadline ? { deadline: f.deadline as Instant | null } : {}),
					...(f.longRunning !== task.longRunning ? { longRunning: f.longRunning } : {}),
					...(f.note !== task.note ? { note: f.note } : {})
				}
			: {
					k: 'createTask',
					title,
					...f,
					deadline: f.deadline as Instant | null,
					...(planToday ? { planFor: today.day } : {})
				};
		const d = app.do(intent);
		if (d.ok) onclose();
		else problem = { field: d.rejection.field, text: d.rejection.problem };
	}

	function act(intent: Intent) {
		app.do(intent);
		onclose();
	}
</script>

<form onsubmit={save}>
	<h2>{task ? 'edit task' : 'new task'}</h2>

	<label class="fld">
		<span class="nm">title</span>
		<input
			class="field"
			bind:value={title}
			autocomplete="off"
			aria-invalid={problem?.field === 'title' ? true : undefined}
		/>
		{#if problem?.field === 'title'}<span class="problem" role="alert">{problem.text}</span>{/if}
	</label>

	<div class="fld" role="radiogroup" aria-labelledby="task-color">
		<span class="nm" id="task-color">color</span>
		<div class="swatches">
			{#each swatches as h (h)}
				<label class="swatch hue" style:--h={h}>
					<input type="radio" name="hue" value={h} bind:group={hue} />
					<span class="visually-hidden">hue {h}</span>
				</label>
			{/each}
		</div>
	</div>

	<div class="fld">
		<label class="nm" for="deadline">deadline</label>
		<!-- An empty date field still shows a date in Safari, so "no deadline" is a button. -->
		{#if deadline}
			<div class="inline">
				<input id="deadline" class="field" type="datetime-local" bind:value={deadline} />
				<button type="button" class="btn quiet" onclick={() => (deadline = '')}>none</button>
			</div>
		{:else}
			<button
				id="deadline"
				type="button"
				class="btn quiet add-deadline"
				onclick={() => (deadline = toLocalInput(Math.ceil((app.now + HOUR) / HOUR) * HOUR))}
			>
				no deadline · add one
			</button>
		{/if}
		{#if problem?.field === 'deadline'}<span class="problem" role="alert">{problem.text}</span>{/if}
	</div>

	<label class="fld toggle">
		<span>
			<span class="nm">long-term</span>
			<span class="hint">a thread that runs across days; offered each morning.</span>
		</span>
		<input class="toggle-switch" type="checkbox" switch bind:checked={longRunning} />
	</label>

	<label class="fld">
		<span class="nm">note</span>
		<textarea class="field" rows="3" bind:value={note} placeholder="anything worth keeping"
		></textarea>
	</label>

	{#if task}
		<div class="more">
			{#if task.status === 'active'}
				<button
					type="button"
					class="chip"
					onclick={() => {
						watch.press(task.id, 'hold');
						onclose();
					}}
					disabled={held && !juggling}
				>
					{held && juggling ? 'let go of it' : 'juggle it in'}
				</button>
			{/if}
			<button
				type="button"
				class="chip"
				onclick={() => act({ k: planned ? 'unplan' : 'plan', day: today.day, task: task.id })}
			>
				{planned ? 'take off today' : 'put on today'}
			</button>
			<button
				type="button"
				class="chip"
				onclick={() =>
					act({ k: 'editTask', task: task.id, status: task.status === 'done' ? 'active' : 'done' })}
			>
				{task.status === 'done' ? 'not done yet' : 'mark done'}
			</button>
			<button
				type="button"
				class="chip"
				onclick={() =>
					act({
						k: 'editTask',
						task: task.id,
						status: task.status === 'archived' ? 'active' : 'archived'
					})}
			>
				{task.status === 'archived' ? 'unarchive' : 'archive'}
			</button>
		</div>
	{/if}

	<div class="acts">
		<button type="button" class="btn quiet" onclick={onclose}>cancel</button>
		<button class="btn primary" disabled={!title.trim()}>{task ? 'save' : planToday ? 'add to today' : 'add task'}</button>
	</div>
</form>

<style>
	h2 {
		margin-bottom: 4px;
		font-size: 22px;
		font-weight: 560;
		letter-spacing: -0.02em;
	}
	.fld {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		padding: 14px 0;
		border: 0;
		border-bottom: 1px solid var(--rule-2);
	}
	.nm {
		font-size: 14px;
		font-weight: 520;
	}
	.problem {
		font-size: 13px;
		color: var(--ink-2);
	}
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}
	.swatch {
		position: relative;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		cursor: pointer;
	}
	.swatch::before {
		content: '';
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--c);
		transition: transform 0.3s var(--spring);
	}
	.swatch::after {
		content: '';
		position: absolute;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1.5px solid var(--c);
		opacity: 0;
		transform: scale(0.8);
		transition:
			opacity 0.2s,
			transform 0.3s var(--spring);
	}
	.swatch:has(input:checked)::after {
		opacity: 1;
		transform: none;
	}
	.swatch:has(input:focus-visible)::after {
		opacity: 1;
		border-color: var(--ink);
	}
	.swatch input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.inline {
		display: flex;
		gap: 8px;
	}
	.inline .btn {
		flex: none;
		min-height: 44px;
	}
	.add-deadline {
		align-self: flex-start;
		min-height: 44px;
		font-weight: 450;
		color: var(--ink-2);
	}
	.toggle {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.toggle > span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.hint {
		font-size: 12.5px;
		color: var(--ink-3);
	}
	textarea {
		resize: vertical;
	}
	.more {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 16px 0 4px;
	}
	.more .chip {
		font-size: 13.5px;
	}
	.more .chip:disabled {
		opacity: 0.4;
	}
	.acts {
		display: flex;
		gap: 10px;
		margin-top: 18px;
	}
	.acts .primary {
		flex: 1;
	}
	.acts .btn:disabled {
		opacity: 0.4;
	}
</style>
