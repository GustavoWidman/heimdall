<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { DayKey } from '#lib/app/app.svelte.ts';
	import DayPager from '#lib/history/DayPager.svelte';
	import DayPanel from '#lib/history/DayPanel.svelte';
	import PeriodHead from '#lib/history/PeriodHead.svelte';
	import {
		addDays,
		isDayKey,
		isoWeek,
		monthKeyOf,
		monthTitle,
		weekOf
	} from '#lib/history/period.ts';
	import { dayLabel } from '#lib/ui/format.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	const { app } = useCtx();
	const today = $derived(app.today.day);
	let { asked }: { asked: string | null } = $props();
	/** With no day in the address, history opens on yesterday: today lives on its own screen. */
	const day = $derived<DayKey>(
		asked !== null && isDayKey(asked) && asked <= today
			? asked
			: addDays(today, asked === null ? -1 : 0)
	);

	const at = (d: DayKey) => resolve('/history/[day]', { day: d });

	$effect(() => {
		if (asked !== day) void goto(at(day), { replace: true, reset: false });
	});

	let pager: DayPager | undefined = $state();
	let picker: HTMLInputElement | undefined = $state();

	function settled(d: DayKey) {
		void goto(at(d), { replace: true, reset: false });
	}

	function pick() {
		if (!picker) return;
		try {
			picker.showPicker();
		} catch {
			picker.focus();
		}
	}

	function jump(e: Event) {
		const v = (e.currentTarget as HTMLInputElement).value;
		if (isDayKey(v) && v <= today) settled(v);
	}
</script>

<svelte:head><title>{dayLabel(day)} · history · heimdall</title></svelte:head>

<PeriodHead
	prev={at(addDays(day, -1))}
	next={day < today ? at(addDays(day, 1)) : null}
	noun="day"
	onstep={(dir) => pager?.step(dir)}
>
	{#snippet kicker()}
		<a href={resolve('/week/[key]', { key: weekOf(day).from })}>week {isoWeek(day)}</a>
		<a href={resolve('/month/[key]', { key: monthKeyOf(day) })}>{monthTitle(monthKeyOf(day))}</a>
	{/snippet}
	{#snippet title()}
		{#if day === today}
			<a class="today" href={resolve('/')} aria-label="{dayLabel(day)}, open today">
				{dayLabel(day)}<span class="label">today</span>
			</a>
		{:else}
			{dayLabel(day)}
		{/if}
	{/snippet}
	<span class="jump">
		<button class="arrow" onclick={pick} aria-label="jump to a date">
			<svg viewBox="0 0 16 16" aria-hidden="true"
				><path d="M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3" /></svg
			>
		</button>
		<input
			bind:this={picker}
			type="date"
			tabindex="-1"
			aria-hidden="true"
			max={today}
			value={day}
			onchange={jump}
		/>
	</span>
</PeriodHead>

<DayPager bind:this={pager} {day} last={today} onsettle={settled}>
	{#snippet panel(d, current)}
		<DayPanel day={d} live={d === today && current} />
	{/snippet}
</DayPager>

<style>
	.today {
		display: inline-flex;
		align-items: baseline;
		gap: 10px;
		text-decoration: none;
	}
	.today .label {
		padding: 1px 7px;
		border: 1px solid var(--rule);
		border-radius: 99px;
		color: var(--ink-2);
	}
	:global(.kicker) a {
		display: inline-flex;
		align-items: center;
		min-height: 24px;
		text-decoration: none;
	}
	:global(.kicker) a:hover {
		color: var(--ink);
	}
	.jump {
		position: relative;
	}
	.jump input {
		position: absolute;
		inset: auto 0 0 auto;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.arrow {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		color: var(--ink-2);
	}
	.arrow:hover {
		background: var(--panel-2);
	}
	svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
