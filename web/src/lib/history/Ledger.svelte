<!--
	Every mark of a day, oldest first: when, from what into what, what kind of move it was,
	and why. Voided marks stay in the list, struck through, because they are part of what
	happened to the notebook.
-->
<script lang="ts">
	import type { Focus, Mark, Transition } from '#lib/app/app.svelte.ts';
	import { clock } from '#lib/ui/format.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import { describe } from '#lib/today/marks.ts';
	import { focusParts, KIND_LABEL, ledger } from './ledger';

	let {
		marks,
		transitions,
		zone
	}: { marks: readonly Mark[]; transitions: readonly Transition[]; zone: string } = $props();

	const { watch } = useCtx();
	const task = (id: Parameters<typeof watch.task>[0]) => watch.task(id);
	const rows = $derived(ledger(marks, transitions));
</script>

{#snippet focus(f: Focus)}
	<span class="focus">
		{#each focusParts(f, task) as p, i (i)}
			{#if i > 0}<span class="plus">+</span>{/if}
			{#if p.k === 'task'}
				<span class="task hue" style:--h={p.hue}><i></i><span class="t">{p.title}</span></span>
			{:else}
				<span class="state">{p.k}</span>
			{/if}
		{/each}
	</span>
{/snippet}

<section class="ledger" aria-label="switch ledger">
	<h2 class="label">switch ledger</h2>
	{#if rows.length === 0}
		<p class="empty">no marks this day.</p>
	{:else}
		<ol>
			{#each rows as r (r.mark.id)}
				<li class:voided={r.voided} class:quiet={!r.voided && r.kind === 'none'}>
					<time class="at mono" datetime={new Date(r.mark.at).toISOString()}>
						{clock(r.mark.at, zone)}
					</time>
					<span class="move">
						{#if r.voided}
							{@const d = describe(r.mark, task)}
							<span class="focus">
								<span class="state">{d.verb}</span>
								{#if d.task}
									<span class="task hue" style:--h={d.task.hue}
										><i></i><span class="t">{d.task.title}</span></span
									>
								{/if}
							</span>
						{:else}
							{@render focus(r.from)}
							<svg class="to" viewBox="0 0 12 8" aria-label="to"
								><path d="M1 4h9M7 1l3 3-3 3" /></svg
							>
							{@render focus(r.to)}
						{/if}
					</span>
					<span class="kind mono" class:switch={!r.voided && r.kind === 'switch'}>
						{r.voided ? 'voided' : KIND_LABEL[r.kind]}
					</span>
					<span class="why mono" class:none={!r.mark.reason}>{r.mark.reason ?? ''}</span>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	h2 {
		font-weight: 400;
		padding: 0 2px 6px;
	}
	.empty {
		padding: 12px 2px;
		font-size: 13px;
		color: var(--ink-3);
		border-top: 1px solid var(--rule);
	}
	ol {
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	li {
		display: grid;
		grid-template-columns: 40px 1fr auto;
		grid-template-areas: 'at move kind' 'at move why';
		column-gap: 10px;
		align-items: center;
		min-height: 44px;
		padding: 7px 2px;
		border-bottom: 1px solid var(--rule-2);
		font-size: 13.5px;
	}
	.at {
		grid-area: at;
		align-self: start;
		padding-top: 1px;
		font-size: 11.5px;
		color: var(--ink-3);
	}
	.move {
		grid-area: move;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 3px 7px;
		min-width: 0;
	}
	.focus {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 3px 5px;
		min-width: 0;
	}
	.task {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		max-width: 100%;
	}
	.task i {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: var(--c);
	}
	.t {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.state,
	.plus {
		color: var(--ink-3);
	}
	.to {
		flex: none;
		width: 12px;
		height: 8px;
		fill: none;
		stroke: var(--ink-4);
		stroke-width: 1.3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.kind {
		grid-area: kind;
		justify-self: end;
		font-size: 10.5px;
		color: var(--ink-3);
	}
	.kind.switch {
		color: var(--ink);
	}
	.why {
		grid-area: why;
		justify-self: end;
		padding: 0 7px;
		border: 1px solid var(--rule);
		border-radius: 99px;
		font-size: 10.5px;
		line-height: 16px;
		color: var(--ink-2);
	}
	.why.none {
		display: none;
	}
	li.voided .move,
	li.voided .at {
		text-decoration: line-through;
		text-decoration-color: var(--ink-3);
	}
	li.voided,
	li.quiet {
		opacity: 0.5;
	}
	li.voided .task i {
		background: var(--ink-4);
	}
	@media (min-width: 1000px) {
		li {
			grid-template-columns: 48px 1fr 80px 70px;
			grid-template-areas: 'at move kind why';
		}
		.at {
			align-self: center;
			padding: 0;
		}
	}
</style>
