<!--
	One day looked back on: its ribbon, totals, where the time went per task, the check-in,
	and the full switch ledger.
-->
<script lang="ts">
	import type { DayKey, Instant } from '#lib/app/app.svelte.ts';
	import { dayLabel, spent } from '#lib/ui/format.ts';
	import Ribbon from '#lib/ui/Ribbon.svelte';
	import Tally from '#lib/ui/Tally.svelte';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import { aggregateDay } from '../domain/stats';
	import CheckInSummary from './CheckInSummary.svelte';
	import Ledger from './Ledger.svelte';

	let { day, live }: { day: DayKey; live: boolean } = $props();

	const { app, watch } = useCtx();
	const page = $derived(app.day(day));
	const now = $derived(live ? app.now : null);
	const zone = $derived(app.settings.timeZone);

	const agg = $derived(
		page.status === 'ready'
			? aggregateDay(page.view, app.settings, now === null ? undefined : (now as Instant))
			: null
	);
	const tasks = $derived(
		agg
			? [...agg.tasks]
					.filter((t) => t.ms > 0 || t.ticks > 0)
					.sort((a, b) => b.ms - a.ms || b.ticks - a.ticks)
					.map((t) => ({ ...t, task: watch.task(t.task) }))
			: []
	);
	const most = $derived(Math.max(1, ...tasks.map((t) => t.ms)));
	const watched = $derived(
		page.status === 'ready' &&
			(page.marks.length > 0 || (agg?.focusMs ?? 0) + (agg?.restMs ?? 0) > 0)
	);
</script>

<div class="day" aria-busy={page.status === 'loading'}>
	{#if page.status === 'ready' && agg}
		<div class="rib">
			<Ribbon view={page.view} {now} {zone} hueOf={watch.hueOf} label={dayLabel(day)} />
		</div>

		<dl class="totals">
			<div>
				<dt>switches</dt>
				<dd class="mono">{agg.switches}</dd>
			</div>
			<div>
				<dt>focus</dt>
				<dd class="mono">{spent(agg.focusMs)}</dd>
			</div>
			<div>
				<dt>juggle</dt>
				<dd class="mono">{spent(agg.juggleMs)}</dd>
			</div>
			<div>
				<dt>load</dt>
				<dd class="mono">{spent(agg.loadMs)}</dd>
			</div>
			<div>
				<dt>rest</dt>
				<dd class="mono">{spent(agg.restMs)}</dd>
			</div>
		</dl>

		{#if !watched}
			<p class="quiet">
				{live ? 'nothing watched yet today.' : 'nothing was watched this day.'}
			</p>
		{/if}

		<div class="cols">
			<div class="main">
				{#if watched}
					<Ledger marks={page.marks} transitions={page.view.transitions} {zone} />
				{/if}
			</div>
			<div class="side">
				{#if tasks.length}
					<section aria-label="by task">
						<h2 class="label">by task</h2>
						<ul class="tasks">
							{#each tasks as t (t.task?.id ?? t.ms)}
								<li class="hue" style:--h={t.task?.hue ?? 0}>
									<span class="name"><i></i>{t.task?.title ?? 'a removed task'}</span>
									<span class="ms mono">{spent(t.ms)}</span>
									<span class="bar" aria-hidden="true"
										><span style:transform="scaleX({t.ms / most})"></span></span
									>
									<span class="meta">
										<Tally
											count={t.ticks}
											hue={t.task?.hue ?? 0}
											seed={t.task?.id ?? ''}
											live={false}
										/>
										<span class="label">
											{t.switchesIn}
											{t.switchesIn === 1 ? 'switch' : 'switches'} in
										</span>
									</span>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				<CheckInSummary {day} checkIn={page.checkIn} />
			</div>
		</div>
	{:else}
		<div class="ghost rib" aria-hidden="true"><span></span></div>
		<p class="label loading">opening {dayLabel(day)}</p>
	{/if}
</div>

<style>
	.day {
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding-top: 16px;
	}
	.totals {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 8px;
	}
	.totals div {
		display: flex;
		flex-direction: column-reverse;
		padding-top: 7px;
		border-top: 1px solid var(--rule);
	}
	.totals dd {
		font-size: 20px;
	}
	@media (max-width: 420px) {
		.totals dd {
			font-size: 17px;
		}
	}
	.totals dt {
		font-size: 12px;
		color: var(--ink-2);
	}
	.quiet {
		padding: 22px 16px;
		border: 1px dashed var(--rule);
		border-radius: 16px;
		text-align: center;
		color: var(--ink-2);
		font-size: 14px;
	}
	.cols,
	.side {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.side h2 {
		padding: 0 2px 6px;
		font-weight: 400;
	}
	.tasks {
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.tasks li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 4px 10px;
		padding: 9px 2px 10px;
		border-bottom: 1px solid var(--rule-2);
	}
	.name {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: 14px;
	}
	.name i {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--c);
	}
	.ms {
		font-size: 13px;
		color: var(--ink-2);
	}
	.bar {
		grid-column: 1 / -1;
		height: 3px;
		border-radius: 2px;
		background: var(--rule-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--c);
		transform-origin: left;
	}
	.meta {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-height: 16px;
	}
	.ghost span {
		display: block;
		height: 30px;
		margin-top: 22px;
		border-radius: 6px;
		box-shadow: inset 0 0 0 1px var(--rule-2);
	}
	.loading {
		text-align: center;
	}
	@media (min-width: 1000px) {
		.day {
			gap: 22px;
			padding-top: 20px;
		}
		.totals {
			max-width: 640px;
		}
		.cols {
			display: grid;
			grid-template-columns: 1fr 360px;
			gap: 40px;
			align-items: start;
		}
		.ghost span {
			height: 44px;
		}
	}
</style>
