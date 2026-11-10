<!--
	A year as a heatmap of days, one metric at a time. On a phone the year folds into two
	halves so each day stays big enough to tap. Arrow keys walk the days; enter opens one.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MediaQuery } from 'svelte/reactivity';
	import type { DayKey } from '#lib/app/app.svelte.ts';
	import { dayLabel } from '#lib/ui/format.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import { level, LEVELS, METRIC_IDS, METRICS, weekGrid, type MetricId } from './metrics';
	import PeriodHead from './PeriodHead.svelte';
	import { addDays, isYearKey, monthShort, WEEKDAYS, yearKeyOf, yearSpan } from './period';
	import { RangeData } from './range.svelte';

	let { asked }: { asked: string | null } = $props();

	const { app } = useCtx();
	const today = $derived(app.today.day);
	const year = $derived(asked !== null && isYearKey(asked) ? asked : yearKeyOf(today));
	const span = $derived(yearSpan(year));
	const at = (y: string) => resolve('/year/[key]', { key: y });
	const shift = (n: number) => String(Number(year) + n).padStart(4, '0');

	$effect(() => {
		if (asked !== year) void goto(at(year), { replace: true, reset: false });
	});

	let metricId: MetricId = $state('switches');
	const metric = $derived(METRICS[metricId]);

	const range = new RangeData(app, () => span);
	const values = $derived(
		new Map(
			(range.rows ?? []).flatMap((r) => {
				const v = metric.value(r);
				return v === null ? [] : [[r.agg.day as string, v] as const];
			})
		)
	);
	const hi = $derived(metric.hi([...values.values()]));

	const wide = new MediaQuery('min-width: 1000px');
	const parts = $derived(
		wide.current
			? [weekGrid(span.from, span.to)]
			: [
					weekGrid(span.from, `${year}-06-30` as DayKey),
					weekGrid(`${year}-07-01` as DayKey, span.to)
				]
	);

	const CELL = 12;
	const GAP = 2;
	const STEP = CELL + GAP;
	const LEFT = 16;
	const TOP = 14;

	function shade(d: string): string {
		if (d > today) return 'ahead';
		const lv = level(values.get(d) ?? null, metric.lo, hi);
		return lv === null ? 'none' : `l${lv}`;
	}

	function months(cells: ReturnType<typeof weekGrid>['cells']) {
		return cells
			.filter((c) => c.day.endsWith('-01'))
			.map((c) => ({ x: c.col, m: monthShort(c.day) }));
	}

	let cursor: DayKey | null = $state(null);
	let hover: DayKey | null = $state(null);
	const pointed = $derived(hover ?? cursor);

	function describe(d: DayKey): string {
		if (d > today) return `${dayLabel(d)}: still ahead`;
		const v = values.get(d);
		return `${dayLabel(d)}: ${v === undefined ? 'nothing recorded' : metric.format(v)}`;
	}

	const summary = $derived.by(() => {
		if (!range.rows) return null;
		if (values.size === 0) {
			return metricId === 'strain' || metricId === 'headache'
				? `no check-ins answered this in ${year} yet.`
				: `nothing watched in ${year} yet. the year fills in a day at a time.`;
		}
		let best: [string, number] = ['', -Infinity];
		let sum = 0;
		for (const [d, v] of values) {
			sum += v;
			if (v > best[1]) best = [d, v];
		}
		const days = `${values.size} ${values.size === 1 ? 'day' : 'days'}`;
		const total =
			metricId === 'switches' || metricId === 'focus' || metricId === 'juggle'
				? `${metric.format(sum)} over ${days}`
				: `answered on ${days}`;
		return `${total}. the most: ${metric.format(best[1])}, ${dayLabel(best[0])}.`;
	});

	const table = $derived(
		Array.from({ length: 12 }, (_, i) => {
			const m = `${year}-${String(i + 1).padStart(2, '0')}`;
			const vs = [...values].filter(([d]) => d.startsWith(m)).map(([, v]) => v);
			return { m: monthShort(m), n: vs.length, sum: vs.reduce((a, b) => a + b, 0) };
		})
	);

	function open(d: DayKey) {
		if (d <= today) void goto(resolve('/history/[day]', { day: d }));
	}

	function onclick(e: MouseEvent) {
		const d = (e.target as Element).closest('[data-day]')?.getAttribute('data-day');
		if (d) open(d as DayKey);
	}

	function onpointermove(e: PointerEvent) {
		if (e.pointerType !== 'mouse') return;
		const d = (e.target as Element).closest('[data-day]')?.getAttribute('data-day');
		hover = (d as DayKey | null) ?? null;
	}

	const MOVES: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };

	function onkeydown(e: KeyboardEvent) {
		const start = cursor ?? (today.startsWith(year) ? today : span.from);
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (cursor) open(cursor);
			else cursor = start;
			return;
		}
		const n = MOVES[e.key];
		if (n === undefined) return;
		e.preventDefault();
		if (!cursor) return void (cursor = start);
		const next = addDays(cursor, n);
		if (next >= span.from && next <= span.to) cursor = next;
	}
</script>

<svelte:head><title>{year} · heimdall</title></svelte:head>

<PeriodHead
	title={year}
	prev={at(shift(-1))}
	next={shift(1) <= yearKeyOf(today) ? at(shift(1)) : null}
	noun="year"
/>

<div class="year">
	<div class="metrics" role="group" aria-label="shade days by">
		{#each METRIC_IDS as id (id)}
			<button class="chip" aria-pressed={metricId === id} onclick={() => (metricId = id)}
				>{METRICS[id].label}</button
			>
		{/each}
	</div>

	<!-- An application region owns its keys; Svelte's a11y lists do not count it as a widget. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="map"
		tabindex="0"
		role="application"
		data-own-arrows
		data-ready={range.rows ? '' : undefined}
		aria-label="{year}, {metric.label} by day. arrow keys move between days, enter opens one."
		aria-describedby="year-readout"
		{onclick}
		{onpointermove}
		onpointerleave={() => (hover = null)}
		{onkeydown}
		onfocus={() => (cursor ??= today.startsWith(year) ? today : span.from)}
		onblur={() => (cursor = null)}
	>
		{#each parts as part, pi (pi)}
			<svg
				viewBox="0 0 {LEFT + part.cols * STEP} {TOP + 7 * STEP}"
				aria-hidden="true"
				class:wide={wide.current}
			>
				{#each months(part.cells) as m (m.m)}
					<text class="mlabel" x={LEFT + m.x * STEP} y={TOP - 4}>{m.m}</text>
				{/each}
				{#each [0, 2, 4] as r (r)}
					<text class="wlabel" x="0" y={TOP + r * STEP + CELL - 2}>{WEEKDAYS[r][0]}</text>
				{/each}
				{#each part.cells as c (c.day)}
					<rect
						data-day={c.day}
						class={shade(c.day)}
						class:today={c.day === today}
						class:cursor={c.day === pointed}
						x={LEFT + c.col * STEP}
						y={TOP + c.row * STEP}
						width={CELL}
						height={CELL}
						rx="2.5"
					/>
				{/each}
			</svg>
		{/each}
	</div>

	<div class="under">
		<p id="year-readout" class="readout mono" aria-live="polite">
			{pointed ? describe(pointed) : (summary ?? `adding up ${year}`)}
		</p>
		<div class="legend" aria-hidden="true">
			<span class="label">less</span>
			{#each { length: LEVELS + 1 }, l (l)}<i class="l{l}"></i>{/each}
			<span class="label">more</span>
		</div>
	</div>
	{#if pointed && summary}<p class="sum">{summary}</p>{/if}

	<table class="visually-hidden">
		<caption>{metric.label} in {year}, by month</caption>
		<thead><tr><th>month</th><th>days with a value</th><th>total</th></tr></thead>
		<tbody>
			{#each table as r (r.m)}
				<tr><td>{r.m}</td><td>{r.n}</td><td>{r.n ? metric.format(r.sum) : ''}</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.year {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding-top: 14px;
	}
	.metrics {
		display: flex;
		gap: 6px;
		margin: 0 calc(-1 * var(--gutter));
		padding: 0 var(--gutter) 2px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.metrics .chip {
		flex: none;
		min-height: 36px;
		padding: 0 12px;
		font-size: 13px;
	}
	.map {
		display: flex;
		flex-direction: column;
		gap: 14px;
		border-radius: 8px;
		touch-action: manipulation;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
		cursor: pointer;
	}
	rect {
		fill: var(--rule-2);
		transition: fill 0.25s;
	}
	rect.none {
		fill: var(--rule-2);
	}
	rect.ahead {
		fill: none;
		stroke: var(--rule-2);
		stroke-width: 0.8;
		cursor: default;
	}
	rect.l0,
	.legend .l0 {
		fill: color-mix(in oklch, var(--ink) 9%, var(--bg));
		background: color-mix(in oklch, var(--ink) 9%, var(--bg));
	}
	rect.l1,
	.legend .l1 {
		fill: color-mix(in oklch, var(--ink) 22%, var(--bg));
		background: color-mix(in oklch, var(--ink) 22%, var(--bg));
	}
	rect.l2,
	.legend .l2 {
		fill: color-mix(in oklch, var(--ink) 38%, var(--bg));
		background: color-mix(in oklch, var(--ink) 38%, var(--bg));
	}
	rect.l3,
	.legend .l3 {
		fill: color-mix(in oklch, var(--ink) 58%, var(--bg));
		background: color-mix(in oklch, var(--ink) 58%, var(--bg));
	}
	rect.l4,
	.legend .l4 {
		fill: color-mix(in oklch, var(--ink) 82%, var(--bg));
		background: color-mix(in oklch, var(--ink) 82%, var(--bg));
	}
	rect.today {
		stroke: var(--ink);
		stroke-width: 1.2;
	}
	rect.cursor {
		stroke: var(--ink);
		stroke-width: 2;
	}
	text {
		font-family: var(--mono);
		font-size: 8px;
		fill: var(--ink-3);
	}
	svg.wide text {
		font-size: 7px;
	}
	.map:focus-visible {
		outline-offset: 6px;
	}
	.under {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
	}
	.readout {
		min-height: 20px;
		font-size: 12.5px;
		color: var(--ink-2);
	}
	.legend {
		display: flex;
		align-items: center;
		gap: 3px;
	}
	.legend i {
		width: 11px;
		height: 11px;
		border-radius: 3px;
	}
	.legend .label:first-child {
		margin-right: 4px;
	}
	.legend .label:last-child {
		margin-left: 4px;
	}
	.sum {
		font-size: 14px;
		color: var(--ink-3);
	}
	@media (min-width: 1000px) {
		.year {
			padding-top: 22px;
			gap: 22px;
		}
		.metrics {
			margin: 0;
			padding: 0;
		}
	}
</style>
