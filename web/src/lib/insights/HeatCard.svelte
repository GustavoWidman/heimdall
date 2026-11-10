<!-- When switching happens: average switches per hour, by weekday, over tracked days. -->
<script lang="ts">
	import Card from './Card.svelte';

	let { heat, days }: { heat: readonly (readonly number[])[]; days: number } = $props();

	const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
	const PLURAL = [
		'mondays',
		'tuesdays',
		'wednesdays',
		'thursdays',
		'fridays',
		'saturdays',
		'sundays'
	];
	const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

	const max = $derived(Math.max(...heat.flat(), 0));
	const hours = $derived.by(() => {
		const any = Array.from({ length: 24 }, (_, h) => heat.some((row) => row[h] > 0));
		const lo = Math.min(8, any.indexOf(true) < 0 ? 8 : any.indexOf(true));
		const hi = Math.max(18, any.lastIndexOf(true));
		return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
	});
	const peak = $derived.by(() => {
		let best = { w: 0, h: 0, v: 0 };
		heat.forEach((row, w) => row.forEach((v, h) => v > best.v && (best = { w, h, v })));
		return best;
	});
	const hourly = $derived(
		Array.from({ length: 24 }, (_, h) => heat.reduce((n, row) => n + row[h], 0))
	);
	const peakHour = $derived(hourly.indexOf(Math.max(...hourly)));
	const busiest = $derived(
		heat.map((row) => {
			const v = Math.max(...row);
			return { h: row.indexOf(v), v };
		})
	);

	let at = $state<{ w: number; h: number } | null>(null);
	const level = (v: number) => (max > 0 ? v / max : 0);
</script>

<Card title="when switching happens" area="heat" meta="average per tracked day">
	<p class="readout" aria-live="polite">
		{#if at}
			<b>{PLURAL[at.w]}, {hh(at.h)}</b> · <b>{heat[at.w][at.h].toFixed(1)}</b> switches in that hour on
			average
		{:else if max > 0 && days < 14}
			busiest around <b>{hh(peakHour)}</b> over {days} tracked {days === 1 ? 'day' : 'days'}; the
			weekday pattern fills in over a few weeks.
		{:else if max > 0}
			busiest on <b>{PLURAL[peak.w]} around {hh(peak.h)}</b>, {peak.v.toFixed(1)} switches in that hour
			on average, over {days} tracked {days === 1 ? 'day' : 'days'}.
		{:else}
			no switches in these days yet.
		{/if}
	</p>

	<div class="heat" style:--n={hours.length} aria-hidden="true">
		<span></span>
		{#each hours as h (h)}
			<span class="hour">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>
		{/each}
		{#each heat as row, w (w)}
			<span class="wd" class:on={at?.w === w}>{WEEKDAYS[w]}</span>
			{#each hours as h (h)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="cell"
					class:zero={row[h] === 0}
					class:on={at?.w === w && at?.h === h}
					style:--a={0.1 + 0.9 * level(row[h])}
					style:--i={w * 3 + (h % 24)}
					onpointerenter={() => (at = { w, h })}
					onpointerdown={() => (at = { w, h })}
					onpointerleave={(e) => e.pointerType === 'mouse' && (at = null)}
				></span>
			{/each}
		{/each}
	</div>

	<div class="legend" aria-hidden="true">
		<span>fewer</span>
		<span class="ramp">
			{#each [0.1, 0.32, 0.55, 0.77, 1] as a (a)}<i style:--a={a}></i>{/each}
		</span>
		<span>more</span>
	</div>

	<div class="visually-hidden">
		<table>
			<caption>Busiest hour for each weekday, average switches in that hour</caption>
			<tbody>
				{#each busiest as b, w (w)}
					<tr><th>{PLURAL[w]}</th><td>{b.v > 0 ? `${hh(b.h)}, ${b.v.toFixed(1)}` : 'none'}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</Card>

<style>
	.heat {
		display: grid;
		grid-template-columns: 30px repeat(var(--n), minmax(0, 1fr));
		gap: 2px;
		align-items: center;
	}
	.hour {
		font-family: var(--mono);
		font-size: 10px;
		color: var(--ink-3);
		white-space: nowrap;
		width: 0;
		overflow: visible;
	}
	.wd {
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--ink-3);
	}
	.wd.on {
		color: var(--ink);
	}
	.cell {
		aspect-ratio: 1;
		max-height: 34px;
		width: 100%;
		border-radius: 3px;
		background: color-mix(in oklab, var(--ink) calc(var(--a) * 100%), var(--panel));
		animation: settle 0.5s var(--snap) both;
		animation-delay: calc(var(--i) * 8ms);
		transition: transform 0.2s var(--spring);
	}
	.cell.zero {
		background: var(--rule-2);
	}
	.cell.on {
		transform: scale(1.18);
		box-shadow:
			0 0 0 2px var(--panel),
			0 0 0 3px var(--ink);
	}
	.ramp {
		gap: 2px !important;
	}
	.ramp i {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: color-mix(in oklab, var(--ink) calc(var(--a) * 100%), var(--panel));
	}
</style>
