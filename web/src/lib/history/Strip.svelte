<!--
	A day's ribbon drawn small, on an hour window shared with the days around it, so a
	week of strips lines up hour under hour. Same paint as the full ribbon.
-->
<script lang="ts">
	import type { DayView, Focus, TaskId } from '#lib/app/app.svelte.ts';
	import { workPaint } from '#lib/ui/hue.ts';
	import type { HourWindow } from './strip';

	let {
		view,
		hours,
		now = null,
		hueOf
	}: {
		view: DayView | null;
		hours: HourWindow;
		/** Closes a live day's open stretch. */
		now?: number | null;
		hueOf: (task: TaskId) => number;
	} = $props();

	const HOUR = 3_600_000;

	const bars = $derived.by(() => {
		if (!view) return [];
		const lo = view.range.start + hours.lo * HOUR;
		const span = (hours.hi - hours.lo) * HOUR;
		const pct = (t: number) => (Math.min(Math.max(t - lo, 0), span) / span) * 100;
		const stretches: { start: number; end: number; focus: Focus }[] = [...view.segments];
		if (view.tail && now !== null) stretches.push({ ...view.tail, end: now });
		return stretches.flatMap((s) => {
			if (s.focus.k === 'off') return [];
			const left = pct(s.start);
			const width = pct(s.end) - left;
			if (width <= 0) return [];
			return [
				{
					key: s.start,
					left,
					width: Math.max(0.3, width),
					rest: s.focus.k === 'rest',
					paint: s.focus.k === 'working' ? workPaint(s.focus.tasks.map(hueOf)) : null
				}
			];
		});
	});
</script>

<span class="strip" aria-hidden="true">
	{#each bars as b (b.key)}
		<i class:rest={b.rest} style:left="{b.left}%" style:width="{b.width}%" style:--paint={b.paint}
		></i>
	{/each}
</span>

<style>
	.strip {
		position: relative;
		display: block;
		height: 18px;
		border-radius: 4px;
		overflow: hidden;
		background: repeating-linear-gradient(90deg, transparent 0 3px, var(--rule-2) 3px 4px);
		box-shadow: inset 0 0 0 1px var(--rule-2);
	}
	i {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--paint);
		border-right: 1px solid var(--bg);
	}
	i.rest {
		top: 7px;
		bottom: 7px;
		border-right: 0;
		background: repeating-linear-gradient(90deg, var(--ink-4) 0 1px, transparent 1px 3px);
	}
	@media (min-width: 1000px) {
		.strip {
			height: 26px;
		}
		i.rest {
			top: 11px;
			bottom: 11px;
		}
	}
</style>
