<!--
	The bifröst week: seven day ribbons stacked on one hour scale, each with its switch
	count and strain, and the week's totals set beside the week before in plain words.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { DayKey } from '#lib/app/app.svelte.ts';
	import { spent } from '#lib/ui/format.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import { rollup } from '../domain/stats';
	import { contrast } from './compare';
	import PeriodHead from './PeriodHead.svelte';
	import {
		addDays,
		daysBetween,
		isDayKey,
		isoWeek,
		monthKeyOf,
		monthTitle,
		spanTitle,
		WEEKDAYS,
		weekOf
	} from './period';
	import { RangeData } from './range.svelte';
	import Strain from './Strain.svelte';
	import Strip from './Strip.svelte';
	import { sharedWindow } from './strip';

	let { asked }: { asked: string | null } = $props();

	const { app, watch } = useCtx();
	const today = $derived(app.today.day);
	const week = $derived(weekOf(asked !== null && isDayKey(asked) ? asked : today));
	const at = (d: DayKey) => resolve('/week/[key]', { key: d });

	$effect(() => {
		if (asked !== week.from) void goto(at(week.from), { replace: true, reset: false });
	});

	const days = $derived(
		daysBetween(week.from, week.to).map((d) => ({ d, page: d <= today ? app.day(d) : null }))
	);
	const live = $derived(week.from <= today && today <= week.to);
	const now = $derived(live ? app.now : null);
	const views = $derived(days.flatMap((x) => (x.page?.status === 'ready' ? [x.page.view] : [])));
	const hours = $derived(sharedWindow(views, now ?? 0));
	const startHour = $derived(app.settings.dayStartHour as number);
	const ticks = $derived(
		Array.from({ length: hours.hi - hours.lo + 1 }, (_, i) => ({
			pct: (i / (hours.hi - hours.lo)) * 100,
			text: String((startHour + hours.lo + i) % 24).padStart(2, '0')
		}))
	);

	const range = new RangeData(app, () => ({ from: addDays(week.from, -7), to: week.to }));
	const totals = $derived.by(() => {
		const rows = range.rows;
		if (!rows) return null;
		const cutoff = live ? addDays(today, -7) : addDays(week.from, -1);
		const cur = rows.filter((r) => r.agg.day >= week.from).map((r) => r.agg);
		const prev = rows.filter((r) => r.agg.day < week.from && r.agg.day <= cutoff).map((r) => r.agg);
		const a = rollup(cur);
		const b = rollup(prev);
		return { a, b, lines: contrast(a, b, live) };
	});
	const rowsOf = (t: NonNullable<typeof totals>) => [
		{ k: 'switches', a: String(t.a.switches), b: String(t.b.switches) },
		{ k: 'focus', a: spent(t.a.focusMs), b: spent(t.b.focusMs) },
		{ k: 'juggle', a: spent(t.a.juggleMs), b: spent(t.b.juggleMs) },
		{ k: 'rest', a: spent(t.a.restMs), b: spent(t.b.restMs) }
	];
	const empty = $derived(
		totals !== null && totals.a.ticks === 0 && totals.a.focusMs === 0 && totals.a.restMs === 0
	);
</script>

<svelte:head><title>week {isoWeek(week.from)} · heimdall</title></svelte:head>

<PeriodHead
	title={spanTitle(week)}
	prev={at(addDays(week.from, -7))}
	next={addDays(week.from, 7) <= today ? at(addDays(week.from, 7)) : null}
	noun="week"
>
	{#snippet kicker()}
		<span>week {isoWeek(week.from)}</span>
		<a href={resolve('/month/[key]', { key: monthKeyOf(week.from) })}
			>{monthTitle(monthKeyOf(week.from))}</a
		>
	{/snippet}
</PeriodHead>

<div class="week">
	<section class="bifrost" aria-label="the week, day by day">
		<p class="label cap">bifröst · <b>the week</b></p>
		<div class="axis" aria-hidden="true">
			<span class="gut"></span>
			<span class="hours">
				{#each ticks as t, i (i)}
					<span class:odd={i % 2 === 1} style:left="{t.pct}%">{t.text}</span>
				{/each}
			</span>
			<span></span>
		</div>
		<ol>
			{#each days as x, i (x.d)}
				{@const ready = x.page?.status === 'ready' ? x.page : null}
				{@const label = `${WEEKDAYS[i]} ${Number(x.d.slice(8))}`}
				<li>
					{#if x.page}
						<a
							class="row"
							class:today={x.d === today}
							href={resolve('/history/[day]', { day: x.d })}
							aria-label="{label}: {ready?.view.switches ?? 0} switches, open the day"
						>
							<span class="d"
								><span>{WEEKDAYS[i]}</span><b class="mono">{Number(x.d.slice(8))}</b></span
							>
							<Strip
								view={ready?.view ?? null}
								{hours}
								now={x.d === today ? now : null}
								hueOf={watch.hueOf}
							/>
							<span class="n mono">{ready ? ready.view.switches : ''}</span>
							<Strain value={ready?.checkIn.strain} />
						</a>
					{:else}
						<span class="row ahead" aria-label="{label}: still ahead">
							<span class="d"
								><span>{WEEKDAYS[i]}</span><b class="mono">{Number(x.d.slice(8))}</b></span
							>
							<Strip view={null} {hours} hueOf={watch.hueOf} />
							<span class="n"></span>
							<span></span>
						</span>
					{/if}
				</li>
			{/each}
		</ol>
		<p class="label key">
			<span>switches</span><span class="pips"><Strain value={3} /> strain from the check-in</span>
		</p>
	</section>

	<section class="totals" aria-label="the week next to the week before">
		<h2 class="label">{live ? 'the week so far' : 'the week, added up'}</h2>
		{#if totals}
			<table>
				<thead>
					<tr
						><th></th><th scope="col">this week</th><th scope="col"
							>{live ? 'same days, last week' : 'last week'}</th
						></tr
					>
				</thead>
				<tbody>
					{#each rowsOf(totals) as r (r.k)}
						<tr
							><th scope="row">{r.k}</th><td class="mono">{r.a}</td><td class="mono b">{r.b}</td
							></tr
						>
					{/each}
				</tbody>
			</table>
			{#if empty}
				<p class="quiet">nothing watched this week yet. the ribbons fill in as you tick.</p>
			{:else}
				<ul class="lines">
					{#each totals.lines as l (l)}<li>{l}</li>{/each}
				</ul>
			{/if}
		{:else}
			<p class="label">adding up the week</p>
		{/if}
	</section>
</div>

<style>
	.week {
		display: flex;
		flex-direction: column;
		gap: 28px;
		padding-top: 16px;
	}
	.cap b {
		color: var(--ink-2);
		font-weight: 500;
	}
	.axis,
	.row {
		display: grid;
		grid-template-columns: 44px 1fr 26px 21px;
		align-items: center;
		column-gap: 10px;
	}
	.axis {
		height: 22px;
		margin-top: 6px;
	}
	.hours {
		position: relative;
		height: 100%;
	}
	.hours span {
		position: absolute;
		bottom: 4px;
		transform: translateX(-50%);
		font-family: var(--mono);
		font-size: 10px;
		color: var(--ink-3);
	}
	.hours span.odd {
		display: none;
	}
	ol {
		list-style: none;
	}
	.row {
		min-height: 44px;
		padding: 0 2px;
		border-top: 1px solid var(--rule-2);
		text-decoration: none;
		border-radius: 4px;
		transition: background-color 0.2s;
	}
	li:last-child .row {
		border-bottom: 1px solid var(--rule-2);
	}
	.d {
		display: flex;
		align-items: baseline;
		gap: 5px;
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.d b {
		font-weight: 500;
		color: var(--ink);
	}
	.today .d span {
		color: var(--ink);
	}
	.today .d b {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--ink);
		color: var(--bg);
	}
	.ahead {
		opacity: 0.45;
	}
	.n {
		font-size: 13px;
		text-align: right;
	}
	@media (hover: hover) {
		a.row:hover {
			background: var(--panel-2);
		}
	}
	.key {
		display: flex;
		justify-content: flex-end;
		gap: 16px;
		margin-top: 10px;
	}
	.pips {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.totals h2 {
		padding: 0 2px 6px;
		font-weight: 400;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		border-top: 1px solid var(--rule);
	}
	th,
	td {
		padding: 8px 2px;
		border-bottom: 1px solid var(--rule-2);
		text-align: right;
		font-weight: 400;
	}
	thead th {
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--ink-3);
	}
	tbody th {
		text-align: left;
		font-size: 13.5px;
		color: var(--ink-2);
	}
	td {
		font-size: 16px;
	}
	td.b {
		color: var(--ink-3);
	}
	.lines {
		list-style: none;
		margin-top: 14px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 14.5px;
		color: var(--ink-2);
	}
	.quiet {
		margin-top: 14px;
		font-size: 14px;
		color: var(--ink-3);
	}
	@media (min-width: 1000px) {
		.week {
			display: grid;
			grid-template-columns: 1fr 340px;
			gap: 48px;
			align-items: start;
			padding-top: 22px;
		}
		.axis,
		.row {
			grid-template-columns: 64px 1fr 36px 21px;
			column-gap: 14px;
		}
		.row {
			min-height: 56px;
		}
		.d {
			font-size: 13.5px;
		}
		.d b {
			font-size: 15px;
		}
		.hours span.odd {
			display: block;
		}
		.n {
			font-size: 15px;
		}
	}
</style>
