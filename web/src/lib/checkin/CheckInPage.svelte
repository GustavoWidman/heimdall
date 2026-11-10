<!--
	The check-in for one day, built from the field registry, so a new field shows up here
	with no change to this file. Answers are written one tap at a time.
-->
<script lang="ts">
	import { slide } from 'svelte/transition';
	import { resolve } from '$app/paths';
	import {
		addDays,
		CHECKIN_FIELDS,
		type CheckIn,
		type CheckInKey,
		type DayKey
	} from '#lib/app/app.svelte.ts';
	import { dayLabel } from '#lib/ui/format.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import Field from './Field.svelte';
	import { SECTIONS, summarize } from './view';

	let { day }: { day: DayKey } = $props();

	const { app } = useCtx();
	const todayKey = $derived(app.today.day);
	const isToday = $derived(day === todayKey);
	const page = $derived(isToday ? null : app.day(day));
	const checkIn: CheckIn | null = $derived(
		isToday ? app.today.checkIn : page?.status === 'ready' ? page.checkIn : null
	);
	const summary = $derived(checkIn ? summarize(checkIn) : null);
	const moreAnswered = $derived(
		checkIn ? SECTIONS.more.filter((k) => checkIn[k] !== undefined).length : 0
	);

	let moreOpen = $state(false);
	let opened = false;
	$effect(() => {
		if (!opened && checkIn) {
			opened = true;
			moreOpen = moreAnswered > 0 || matchMedia('(min-width: 1000px)').matches;
		}
	});

	const prev = $derived(addDays(day, -1));
	const next = $derived(addDays(day, 1));
	const dayHref = (d: DayKey) =>
		d === todayKey ? resolve('/checkin') : resolve('/checkin/[day]', { day: d });

	function set(key: CheckInKey, value: unknown) {
		app.do({ k: 'checkIn', day, patch: { [key]: value } });
	}
</script>

<svelte:head><title>check-in · {dayLabel(day)} · heimdall</title></svelte:head>

<article class="checkin">
	<header class="head">
		<a class="step" href={dayHref(prev)} aria-label="the day before, {dayLabel(prev)}">
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5" /></svg>
		</a>
		<div class="title">
			<h1>{isToday ? 'how today felt' : 'how the day felt'}</h1>
			<p class="label">{dayLabel(day)}{isToday ? ' · today' : ''}</p>
		</div>
		{#if isToday}
			<span class="step" aria-hidden="true"></span>
		{:else}
			<a class="step" href={dayHref(next)} aria-label="the day after, {dayLabel(next)}">
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>
			</a>
		{/if}
	</header>

	<p class="summary" aria-live="polite">
		{#if summary}
			<span class="mono n">{summary.answered}/{summary.of}</span>
			{#each summary.parts as p (p.name)}
				<span class="part"><span class="k">{p.name}</span> {p.answer}</span>
			{/each}
		{:else if checkIn && !isToday}
			nothing written for this day. that’s fine; it can still be filled in.
		{:else}
			every question is optional. tap an answer and it is kept.
		{/if}
	</p>

	{#if checkIn}
		<div class="cols">
			<section class="core" aria-label="the day">
				{#each SECTIONS.shown as key (key)}
					<Field
						{key}
						def={CHECKIN_FIELDS[key]}
						value={checkIn[key]}
						today={isToday}
						onset={(v) => set(key, v)}
					/>
				{/each}
			</section>

			<section class="more" aria-label="more questions">
				<button
					class="fold"
					aria-expanded={moreOpen}
					aria-controls="checkin-more"
					onclick={() => (moreOpen = !moreOpen)}
				>
					<span>more</span>
					<span class="label">
						{SECTIONS.more.length} optional{moreAnswered ? ` · ${moreAnswered} answered` : ''}
					</span>
					<svg class:up={moreOpen} viewBox="0 0 16 16" aria-hidden="true"
						><path d="M3.5 6L8 10.5 12.5 6" /></svg
					>
				</button>
				{#if moreOpen}
					<div id="checkin-more" transition:slide={{ duration: 260 }}>
						{#each SECTIONS.more as key (key)}
							<Field
								{key}
								def={CHECKIN_FIELDS[key]}
								value={checkIn[key]}
								today={isToday}
								onset={(v) => set(key, v)}
							/>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	{:else}
		<p class="loading label">opening the day…</p>
	{/if}

	<footer class="caveat">
		patterns, not diagnoses. heimdall is not a medical tool. headaches that are new, severe, or
		frequent are worth raising with a clinician.
	</footer>
</article>

<style>
	.checkin {
		display: flex;
		flex-direction: column;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 0 4px;
	}
	.title {
		flex: 1;
		text-align: center;
	}
	h1 {
		font-size: 22px;
		font-weight: 560;
		letter-spacing: -0.02em;
	}
	.title .label {
		margin-top: 2px;
	}
	.step {
		display: grid;
		place-items: center;
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		color: var(--ink-2);
	}
	.step svg,
	.fold svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.summary {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 2px 10px;
		min-height: 40px;
		padding: 10px 4px 12px;
		border-bottom: 1px solid var(--rule);
		font-size: 12.5px;
		color: var(--ink-3);
		text-align: center;
	}
	.summary .n {
		color: var(--ink-2);
	}
	.summary .part {
		white-space: nowrap;
		animation: appear 0.3s var(--snap);
	}
	.summary .k {
		color: var(--ink-3);
	}
	.fold {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 56px;
		padding: 0;
		border-bottom: 1px solid var(--rule-2);
		font-size: 15px;
		text-align: left;
	}
	.fold .label {
		margin-left: auto;
	}
	.fold svg {
		color: var(--ink-3);
		transition: transform 0.35s var(--spring);
	}
	.fold svg.up {
		transform: rotate(180deg);
	}
	.loading {
		padding: 40px 0;
		text-align: center;
	}
	.caveat {
		max-width: 46ch;
		margin: 28px auto 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--ink-3);
		text-align: center;
	}
	@keyframes appear {
		from {
			opacity: 0;
			transform: translateY(2px);
		}
	}

	@media (min-width: 1000px) {
		.checkin {
			max-width: 1080px;
			margin: 0 auto;
			padding-top: 16px;
		}
		.cols {
			display: grid;
			grid-template-columns: 1fr 1fr;
			column-gap: 56px;
			align-items: start;
		}
		.summary {
			margin-bottom: 4px;
		}
	}
</style>
