<!--
	Which tag takes the switches, the focus and the juggling: each tag's share of the window,
	tasks without a tag as a row of their own, and how the switches split into hard, soft and
	unsorted.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { SWITCH_CLASSES, type AreaBreakdown, type AreaRow } from '#lib/app/app.svelte.ts';
	import { spent } from '#lib/ui/format.ts';
	import Card from './Card.svelte';

	let { areas, named }: { areas: AreaBreakdown; named: boolean } = $props();

	type Measure = {
		readonly key: string;
		readonly label: string;
		readonly about: string;
		readonly value: (r: AreaRow) => number;
		readonly text: (r: AreaRow) => string;
	};
	const MEASURES: readonly Measure[] = [
		{
			key: 'switches',
			label: 'switches',
			about: 'switches into each tag’s tasks',
			value: (r) => r.switches.total,
			text: (r) => String(r.switches.total)
		},
		{
			key: 'focus',
			label: 'focus',
			about: 'time in focus, a juggle split evenly between its tasks',
			value: (r) => r.focusMs,
			text: (r) => spent(r.focusMs)
		},
		{
			key: 'juggle',
			label: 'juggle',
			about: 'time juggling, split evenly between the tasks held',
			value: (r) => r.juggleMs,
			text: (r) => spent(r.juggleMs)
		}
	];

	let picked = $state(MEASURES[0].key);
	const measure = $derived(MEASURES.find((m) => m.key === picked) ?? MEASURES[0]);
	const rows = $derived(
		areas.rows
			.filter((r) => measure.value(r) > 0)
			.toSorted(
				(a, b) =>
					Number(a.area === null) - Number(b.area === null) || measure.value(b) - measure.value(a)
			)
	);
	const total = $derived(rows.reduce((n, r) => n + measure.value(r), 0));
	const share = (v: number) => (total > 0 ? Math.round((100 * v) / total) : 0);
	const all = $derived(areas.switches);
</script>

<Card title="tags" area="tags" meta={named ? measure.about : undefined}>
	{#if !named}
		<p class="quiet">
			give tasks a tag, like work or college, on the <a href={resolve('/tasks')}>tasks</a> page to see
			which one takes your switches.
		</p>
	{:else}
		<div class="measures" role="group" aria-label="measure tags by">
			{#each MEASURES as m (m.key)}
				<button class="chip" aria-pressed={picked === m.key} onclick={() => (picked = m.key)}>
					{m.label}
				</button>
			{/each}
		</div>

		<p class="readout">
			{#if all.total}
				<b>{all.total}</b>
				{all.total === 1 ? 'switch' : 'switches'}
				{#each SWITCH_CLASSES as c (c)}
					· <b>{all[c]}</b> {c}{' '}
				{/each}
			{:else}
				no switches in these days yet.
			{/if}
		</p>

		{#if rows.length}
			<ol>
				{#each rows as r, i (r.area)}
					<li style:--i={i}>
						<span class="name" class:none={r.area === null}>{r.area ?? 'no tag'}</span>
						<span class="value mono">
							<b>{share(measure.value(r))}%</b>
							{measure.text(r)}
						</span>
						<span class="track" aria-hidden="true">
							{#if measure.key === 'switches'}
								{#each SWITCH_CLASSES as c (c)}
									<i class="fill {c}" style:--v={r.switches[c] / total}></i>
								{/each}
							{:else}
								<i class="fill" class:none={r.area === null} style:--v={measure.value(r) / total}
								></i>
							{/if}
						</span>
						{#if measure.key === 'switches'}
							<span class="context mono">
								{r.switches.hard} hard · {r.switches.soft} soft · {r.switches.unsorted} unsorted
							</span>
						{/if}
					</li>
				{/each}
			</ol>
			{#if measure.key === 'switches'}
				<div class="legend" aria-hidden="true">
					{#each SWITCH_CLASSES as c (c)}<span><i class="key {c}"></i>{c}</span>{/each}
				</div>
			{/if}
		{:else}
			<p class="quiet">
				{measure.key === 'juggle' ? 'no juggling in these days.' : 'no focus time in these days.'}
			</p>
		{/if}
	{/if}
</Card>

<style>
	.measures {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 12px;
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 14.5px;
	}
	.name.none {
		color: var(--ink-2);
	}
	.value {
		font-size: 13px;
		text-align: right;
		color: var(--ink-2);
	}
	.value b {
		font-weight: 500;
		color: var(--ink);
	}
	.track {
		grid-column: 1 / -1;
		display: flex;
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
		background: var(--rule-2);
	}
	.fill {
		display: block;
		flex: none;
		width: calc(var(--v) * 100%);
		height: 100%;
		background: var(--ink-2);
		transition: width 0.5s var(--snap);
	}
	.fill.hard,
	.key.hard {
		background: var(--ink);
	}
	.fill.soft,
	.key.soft {
		background: var(--ink-4);
	}
	.fill.unsorted,
	.fill.none,
	.key.unsorted {
		background: repeating-linear-gradient(135deg, var(--ink-3) 0 1.5px, transparent 1.5px 4px);
	}
	.key {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.context {
		grid-column: 1 / -1;
		font-size: 11px;
		color: var(--ink-3);
	}
	.quiet {
		font-size: 14px;
		color: var(--ink-2);
	}
	.quiet a {
		text-decoration: underline;
		text-decoration-color: var(--ink-4);
		text-underline-offset: 3px;
	}
</style>
