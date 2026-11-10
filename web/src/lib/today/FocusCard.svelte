<!--
	The instrument: a big iris on what you hold, its name, and a live timer. The timer adds
	the open stretch to now; it never re-derives the day. "since" opens the tick that began
	the stretch, to move it when the switch really happened earlier.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import type { Focus, MarkId } from '#lib/app/app.svelte.ts';
	import { clock, deadlineLabel, timer } from '#lib/ui/format.ts';
	import Iris from '#lib/ui/Iris.svelte';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	let { onfix }: { onfix?: (mark: MarkId) => void } = $props();

	const { app, watch } = useCtx();

	const today = $derived(app.today);
	const tail = $derived(today.view.tail);
	const focus: Focus = $derived(today.view.state.focus);
	const zone = $derived(app.settings.timeZone);
	const held = $derived(focus.k === 'working' ? focus.tasks.map((id) => watch.task(id)) : []);
	const key = $derived(focus.k === 'working' ? focus.tasks.join() : focus.k);

	// The big iris shutters closed on the old focus, then opens on the new one.
	let shown = $state({ key: '', hues: [] as number[], open: false });
	$effect(() => {
		const next = {
			key,
			hues: held.flatMap((t) => (t ? [t.hue] : [])),
			open: focus.k === 'working'
		};
		const prev = untrack(() => shown);
		if (!prev.open || next.key === prev.key) {
			shown = next;
			return;
		}
		shown = { ...prev, open: false };
		const id = setTimeout(() => (shown = next), 170);
		return () => clearTimeout(id);
	});

	const elapsed = $derived(tail ? timer(app.now - tail.since) : null);
	const single = $derived(held.length === 1 ? held[0] : undefined);
	const sub = $derived.by(() => {
		if (focus.k === 'rest') return 'a break is part of the watch.';
		if (focus.k === 'off') return 'tap a task when you start.';
		if (held.length > 1) return 'one switch, however many bounces.';
		if (single?.deadline != null) {
			const d = deadlineLabel(single.deadline, app.now, zone);
			return single.deadline > app.now ? `${d.text} left` : d.text;
		}
		return single?.longRunning ? 'long-term · no clock on this one' : 'no deadline';
	});
	const ripple = $derived(watch.moment?.seq ?? 0);
</script>

<section
	class="focus hue"
	class:resting={focus.k === 'rest'}
	style:--h={held[0]?.hue ?? null}
	aria-label="now"
>
	<div class="eye">
		<span class="ring" aria-hidden="true">
			{#each { length: 24 }, i (i)}<i
					style:transform="rotate({i * 15}deg)"
					class:minor={i % 6 !== 0}
				></i>{/each}
		</span>
		<Iris size="var(--eye)" hues={shown.hues} open={shown.open} />
		{#key ripple}{#if ripple}<span class="ripple" aria-hidden="true"></span>{/if}{/key}
	</div>

	{#key key}
		<div class="meta" in:fly={{ y: 8, duration: 420 }} aria-live="polite">
			<p class="state label">
				<span class="dot"></span>
				{#if focus.k === 'working'}
					{held.length > 1 ? `juggling · ${held.length}` : 'watching'}
				{:else if focus.k === 'rest'}
					resting
				{:else}
					quiet
				{/if}
				{#if tail && focus.k !== 'off'}
					·
					{#if tail.mark && onfix}
						{@const mark = tail.mark}
						<button
							class="since"
							aria-label="since {clock(tail.since, zone)}, change when it began"
							onclick={() => onfix(mark)}>since {clock(tail.since, zone)}</button
						>
					{:else}
						since {clock(tail.since, zone)}
					{/if}
				{/if}
			</p>
			<h2 class="title" class:many={held.length > 1}>
				{#if focus.k === 'rest'}
					eyes closed
				{:else if focus.k === 'off'}
					nothing on watch
				{:else if held.length === 1}
					<span class="one">{held[0]?.title}</span>
				{:else}
					{#each held as t, i (t?.id ?? i)}
						{#if i > 0}<svg class="swap" viewBox="0 0 16 16" aria-label="and"
								><path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" /></svg
							>{/if}
						<span class="held hue" style:--h={t?.hue}><i></i><em>{t?.title}</em></span>
					{/each}
				{/if}
			</h2>
		</div>
	{/key}
	<div class="readout">
		{#if elapsed && focus.k !== 'off'}
			<p class="timer mono" role="timer" aria-label="time on this">
				{elapsed.main}<span class="s">:{elapsed.seconds}</span>
			</p>
		{:else}
			<p class="timer mono idle" aria-hidden="true">--<span class="s">:--</span></p>
		{/if}
		<p class="sub">{sub}</p>
	</div>
</section>

<style>
	.focus {
		--eye: 84px;
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-areas: 'eye meta' 'eye readout';
		column-gap: 18px;
		align-items: center;
		padding: 18px 16px;
		/* Room for a two-line juggle, so the board never moves under the thumb. */
		min-height: 156px;
		border-radius: 20px;
		background: var(--panel);
		border: 1px solid var(--rule-2);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	.eye {
		grid-area: eye;
		position: relative;
		width: var(--eye);
		height: var(--eye);
		margin: 8px;
	}
	.eye :global(.iris .blade b) {
		transition-duration: 0.5s;
	}
	.ring {
		position: absolute;
		inset: -9px;
		border-radius: 50%;
		border: 1px dashed var(--rule);
		pointer-events: none;
	}
	.ring i {
		position: absolute;
		left: 50%;
		top: -1px;
		width: 1px;
		height: 5px;
		background: var(--ink-3);
		transform-origin: 0 calc(var(--eye) / 2 + 9px);
	}
	.ring i.minor {
		opacity: 0.45;
	}
	.ripple {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 1.5px solid var(--c, var(--ink-3));
		pointer-events: none;
		animation: ripple 0.8s var(--snap) forwards;
	}
	@keyframes ripple {
		from {
			opacity: 0.7;
			transform: scale(0.9);
		}
		to {
			opacity: 0;
			transform: scale(2.4);
		}
	}
	.meta {
		grid-area: meta;
		align-self: end;
		min-width: 0;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--c, var(--ink-3));
		animation: breathe 2.4s ease-in-out infinite;
	}
	.resting .dot {
		background: var(--ink-3);
	}
	.since {
		position: relative;
		font: inherit;
		letter-spacing: inherit;
		color: inherit;
		text-decoration: underline dotted var(--ink-4);
		text-underline-offset: 3px;
		transition: color 0.2s;
	}
	/* A finger-sized target around small text. */
	.since::after {
		content: '';
		position: absolute;
		inset: -14px -8px;
	}
	@media (hover: hover) {
		.since:hover {
			color: var(--ink);
		}
	}
	.title {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 3px;
		min-width: 0;
		font-size: 19px;
		font-weight: 540;
		letter-spacing: -0.015em;
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.one {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.title.many {
		flex-wrap: wrap;
		row-gap: 2px;
		font-size: 17px;
	}
	.held {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		max-width: 100%;
	}
	.held i {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: var(--c);
	}
	.held em {
		font-style: normal;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.swap {
		flex: none;
		width: 14px;
		height: 14px;
		fill: none;
		stroke: var(--ink-3);
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		animation: bounce 1.4s var(--snap) infinite;
	}
	@keyframes bounce {
		0%,
		100% {
			transform: translateX(-1.5px);
		}
		50% {
			transform: translateX(1.5px);
		}
	}
	.readout {
		grid-area: readout;
		align-self: start;
		min-width: 0;
	}
	.timer {
		font-size: 34px;
		font-weight: 450;
		letter-spacing: -0.03em;
		line-height: 1.05;
		margin-top: 2px;
	}
	.timer .s,
	.timer.idle {
		color: var(--ink-3);
	}
	.sub {
		margin-top: 4px;
		font-size: 12.5px;
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (min-width: 1000px) {
		.focus {
			--eye: 150px;
			grid-template-columns: 1fr;
			grid-template-areas: 'eye' 'meta' 'readout';
			justify-items: center;
			row-gap: 0;
			padding: 34px 22px 26px;
			text-align: center;
		}
		.eye {
			margin: 4px 0 26px;
		}
		.ring {
			inset: -13px;
		}
		.ring i {
			top: -1px;
			height: 7px;
			transform-origin: 0 calc(var(--eye) / 2 + 13px);
		}
		.meta,
		.readout {
			width: 100%;
		}
		.state,
		.title {
			justify-content: center;
		}
		.title {
			font-size: 22px;
		}
		.timer {
			font-size: 56px;
		}
	}
</style>
