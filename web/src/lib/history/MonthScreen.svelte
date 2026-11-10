<!--
	A month as a calendar: each day shaded by how many switches it held, on one calm ink
	scale, with small signs from the check-in. A day opens its history.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { DaySummary } from '#lib/app/app.svelte.ts';
	import { dayLabel, spent } from '#lib/ui/format.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import { rollup } from '../domain/stats';
	import DayMarks from './DayMarks.svelte';
	import { level, LEVELS, METRICS, tracked } from './metrics';
	import PeriodHead from './PeriodHead.svelte';
	import {
		daysBetween,
		isMonthKey,
		monthKeyOf,
		monthSpan,
		monthTitle,
		shiftMonth,
		WEEKDAYS,
		weekday,
		yearKeyOf
	} from './period';
	import { RangeData } from './range.svelte';

	let { asked }: { asked: string | null } = $props();

	const { app } = useCtx();
	const today = $derived(app.today.day);
	const month = $derived(asked !== null && isMonthKey(asked) ? asked : monthKeyOf(today));
	const span = $derived(monthSpan(month));
	const at = (m: string) => resolve('/month/[key]', { key: m });

	$effect(() => {
		if (asked !== month) void goto(at(month), { replace: true, reset: false });
	});

	const range = new RangeData(app, () => span);
	const byDay = $derived(new Map((range.rows ?? []).map((r) => [r.agg.day as string, r])));
	const hi = $derived(
		METRICS.switches.hi((range.rows ?? []).flatMap((r) => (tracked(r.agg) ? [r.agg.switches] : [])))
	);

	const lead = $derived(weekday(span.from));
	const cells = $derived(
		daysBetween(span.from, span.to).map((d) => {
			const s: DaySummary | undefined = byDay.get(d);
			const on = s && tracked(s.agg);
			const words = [dayLabel(d)];
			if (s) {
				if (on) words.push(METRICS.switches.format(s.agg.switches));
				if (s.checkIn.headache) words.push(METRICS.headache.format(s.checkIn.headache));
				if (s.checkIn.cried) words.push('cried');
				if (s.checkIn.laughed) words.push('laughed');
			}
			return {
				d,
				n: Number(d.slice(8)),
				future: d > today,
				s,
				lv: on ? level(s.agg.switches, 0, hi) : null,
				label: words.join(', ')
			};
		})
	);
	const totals = $derived(range.rows ? rollup(range.rows.map((r) => r.agg)) : null);
	const watchedDays = $derived((range.rows ?? []).filter((r) => tracked(r.agg)).length);
</script>

<svelte:head><title>{monthTitle(month)} · heimdall</title></svelte:head>

<PeriodHead
	title={monthTitle(month)}
	prev={at(shiftMonth(month, -1))}
	next={shiftMonth(month, 1) <= monthKeyOf(today) ? at(shiftMonth(month, 1)) : null}
	noun="month"
>
	{#snippet kicker()}
		<a href={resolve('/year/[key]', { key: yearKeyOf(span.from) })}>{yearKeyOf(span.from)}</a>
	{/snippet}
</PeriodHead>

<div class="month">
	<section class="cal" aria-label="{monthTitle(month)}, day by day">
		<div class="grid" role="presentation">
			{#each WEEKDAYS as w (w)}<span class="wd label" aria-hidden="true">{w[0]}</span>{/each}
			{#each cells as c, i (c.d)}
				{#if c.future}
					<span class="cell ahead" style:grid-column-start={i === 0 ? lead + 1 : null}>
						<span class="n mono">{c.n}</span>
					</span>
				{:else}
					<a
						class="cell"
						class:on={c.lv !== null}
						class:dark={c.lv !== null && c.lv >= 3}
						class:today={c.d === today}
						style:--lv={c.lv ?? 0}
						style:grid-column-start={i === 0 ? lead + 1 : null}
						href={resolve('/history/[day]', { day: c.d })}
					>
						<span class="visually-hidden">{c.label}</span>
						<span class="n mono" aria-hidden="true">{c.n}</span>
						{#if c.s}
							<span class="foot">
								<DayMarks checkIn={c.s.checkIn} />
								{#if c.lv !== null}<span class="sw mono" aria-hidden="true">{c.s.agg.switches}</span
									>{/if}
							</span>
						{/if}
					</a>
				{/if}
			{/each}
		</div>
	</section>

	<aside class="side">
		<div class="legend" aria-hidden="true">
			<span class="label">fewer</span>
			{#each { length: LEVELS + 1 }, l (l)}<i style:--lv={l}></i>{/each}
			<span class="label">more switches</span>
		</div>
		<p class="signs label" aria-hidden="true">
			<span><DayMarks checkIn={{ headache: 2 }} /> headache</span>
			<span><DayMarks checkIn={{ cried: 1 }} /> cried</span>
			<span><DayMarks checkIn={{ laughed: 1 }} /> laughed</span>
		</p>
		{#if totals}
			<p class="sum">
				{#if watchedDays === 0}
					nothing watched this month yet. days shade in as you tick.
				{:else}
					{totals.switches}
					{totals.switches === 1 ? 'switch' : 'switches'} over {watchedDays}
					{watchedDays === 1 ? 'day' : 'days'} watched, with {spent(totals.focusMs)} of focus and {spent(
						totals.juggleMs
					)} juggling.
				{/if}
			</p>
		{/if}
	</aside>
</div>

<style>
	.month {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding-top: 14px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 4px;
	}
	.wd {
		padding-bottom: 2px;
		text-align: center;
	}
	.cell {
		--shade: color-mix(in oklch, var(--ink) calc(4% + var(--lv) * 13%), var(--bg));
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		aspect-ratio: 1 / 1.08;
		min-height: 44px;
		padding: 5px 5px 4px;
		border-radius: 8px;
		box-shadow: inset 0 0 0 1px var(--rule-2);
		color: var(--ink-2);
		text-decoration: none;
		transition: transform 0.3s var(--spring);
	}
	.cell:active {
		transform: scale(0.94);
	}
	.cell.on {
		background: var(--shade);
		box-shadow: none;
		color: var(--ink);
	}
	.cell.dark {
		color: var(--bg);
	}
	.cell.today {
		box-shadow: inset 0 0 0 1.5px var(--ink);
	}
	.ahead {
		box-shadow: none;
		color: var(--ink-3);
	}
	.n {
		font-size: 11.5px;
	}
	.foot {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 2px;
		min-height: 12px;
	}
	.sw {
		margin-left: auto;
		font-size: 10px;
	}
	.legend {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.legend i {
		width: 14px;
		height: 14px;
		border-radius: 4px;
		background: color-mix(in oklch, var(--ink) calc(4% + var(--lv) * 13%), var(--bg));
	}
	.legend .label:first-child {
		margin-right: 4px;
	}
	.legend .label:last-child {
		margin-left: 4px;
	}
	.signs {
		display: flex;
		gap: 16px;
		margin-top: 10px;
		color: var(--ink-2);
	}
	.signs span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.sum {
		margin-top: 16px;
		font-size: 14.5px;
		color: var(--ink-2);
	}
	@media (min-width: 1000px) {
		.month {
			display: grid;
			grid-template-columns: minmax(0, 820px) 1fr;
			gap: 48px;
			align-items: start;
			padding-top: 22px;
		}
		.grid {
			gap: 6px;
		}
		.cell {
			aspect-ratio: 1.35 / 1;
			padding: 9px 10px 8px;
			border-radius: 10px;
		}
		.n {
			font-size: 13px;
		}
		.sw {
			font-size: 12px;
		}
		.side {
			padding-top: 24px;
		}
	}
</style>
