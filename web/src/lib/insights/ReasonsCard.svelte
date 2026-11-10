<!--
	Why switching happens: one small strip per reason over the window, on one shared scale,
	and the switches given no reason shown as plainly as the rest.
-->
<script lang="ts">
	import type { DayKey, Insights } from '#lib/app/app.svelte.ts';
	import { dayLabel } from '#lib/ui/format.ts';
	import Card from './Card.svelte';
	import Days from './Days.svelte';
	import { reasonBuckets, weekTicks, type ReasonKey } from './scale';

	let {
		data,
		today,
		selected = $bindable(null),
		onopen
	}: {
		data: Insights;
		today: DayKey;
		selected?: DayKey | null;
		onopen: (day: DayKey) => void;
	} = $props();

	const ROWS: readonly { key: ReasonKey; label: string }[] = [
		{ key: 'urge', label: 'urge' },
		{ key: 'pulled', label: 'pulled' },
		{ key: 'done', label: 'done' },
		{ key: 'blocked', label: 'blocked' },
		{ key: 'untagged', label: 'no reason' }
	];
	const ROW = 26;
	const GAP = 8;

	const buckets = $derived(reasonBuckets(data.series));
	const weekly = $derived(buckets.length < data.series.length);
	const max = $derived(Math.max(1, ...buckets.flatMap((b) => ROWS.map((r) => b.reasons[r.key]))));
	const totals = $derived(data.totals.reasons);
	const all = $derived(data.totals.switches);
	const tagged = $derived(all - totals.untagged);
	const share = (n: number, of: number) => (of > 0 ? Math.round((100 * n) / of) : 0);

	let local = $state<DayKey | null>(null);
	const at = $derived(weekly ? local : selected);
	const bucket = $derived(at ? buckets.find((b) => b.key === at) : undefined);
	const days = $derived(buckets.map((b) => b.key));
</script>

{#snippet strip(i: number)}
	{@const b = buckets[i]}
	{#each ROWS as r, k (r.key)}
		<div class="clip" style:top="{k * (ROW + GAP)}px" style:height="{ROW}px">
			{#if b.reasons[r.key]}
				<div
					class="bar"
					class:untagged={r.key === 'untagged'}
					class:today={b.key === today}
					style:--v={b.reasons[r.key] / max}
					style:--i={i}
				></div>
			{/if}
		</div>
		<div class="base" style:top="{k * (ROW + GAP) + ROW}px"></div>
	{/each}
{/snippet}

<Card title="why you switched" area="why" meta={weekly ? 'per week' : 'per day'}>
	<p class="readout" aria-live="polite">
		{#if bucket}
			<b>{weekly ? `week of ${dayLabel(bucket.key)}` : dayLabel(bucket.key)}</b> ·
			{#each ROWS as r, k (r.key)}{k ? ' · ' : ''}{r.label} <b>{bucket.reasons[r.key]}</b>{/each}
		{:else if all}
			{#if tagged}
				shares are of the {tagged} switches you gave a reason;
			{/if}
			<b>{share(totals.untagged, all)}%</b> of all {all} switches have none.
		{:else}
			no switches in these days yet.
		{/if}
	</p>

	<div class="rows">
		<div class="names" aria-hidden="true">
			{#each ROWS as r (r.key)}
				<div class="name" style:height="{ROW}px" style:margin-bottom="{GAP}px">
					<span>{r.label}</span>
					<b
						>{r.key === 'untagged'
							? `${share(totals.untagged, all)}%`
							: `${share(totals[r.key], tagged)}%`}</b
					>
				</div>
			{/each}
		</div>
		<div class="strips">
			{#if weekly}
				<Days
					{days}
					bind:selected={local}
					ticks={weekTicks(buckets)}
					label="Reasons per week"
					height={5 * (ROW + GAP)}
					onopen={() => {}}
				>
					{#snippet col(i)}
						{@render strip(i)}
					{/snippet}
				</Days>
			{:else}
				<Days {days} bind:selected label="Reasons per day" height={5 * (ROW + GAP)} {onopen}>
					{#snippet col(i)}
						{@render strip(i)}
					{/snippet}
				</Days>
			{/if}
		</div>
	</div>

	<div class="visually-hidden">
		<table>
			<caption>Switches by reason, {weekly ? 'per week' : 'per day'}</caption>
			<thead>
				<tr
					><th>{weekly ? 'week of' : 'day'}</th>{#each ROWS as r (r.key)}<th>{r.label}</th
						>{/each}</tr
				>
			</thead>
			<tbody>
				{#each buckets as b (b.key)}
					<tr>
						<td>{dayLabel(b.key)}</td>{#each ROWS as r (r.key)}<td>{b.reasons[r.key]}</td>{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Card>

<style>
	.rows {
		display: grid;
		grid-template-columns: 84px minmax(0, 1fr);
		gap: 8px;
	}
	.name {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 6px;
		font-size: 12.5px;
		color: var(--ink-2);
		border-bottom: 1px solid transparent;
	}
	.name b {
		font-family: var(--mono);
		font-size: 11px;
		font-weight: 400;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
	.clip {
		bottom: auto;
	}
	.base {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--rule-2);
		pointer-events: none;
	}
	.bar {
		position: absolute;
		left: 50%;
		bottom: 0;
		width: min(24px, calc(100% - 2px));
		height: 100%;
		border-radius: 3px 3px 0 0;
		background: var(--ink-2);
		transform: translateX(-50%) translateY(calc((1 - var(--v)) * 100%));
		transition: transform 0.5s var(--snap);
		animation: rise 0.7s var(--snap) both;
		animation-delay: calc(var(--i) * 10ms);
	}
	.bar.untagged {
		background: repeating-linear-gradient(135deg, var(--ink-3) 0 1.5px, transparent 1.5px 4px);
		box-shadow: inset 0 1.5px 0 var(--ink-3);
	}
	:global(.col.on) .bar:not(.untagged) {
		background: var(--ink);
	}
</style>
