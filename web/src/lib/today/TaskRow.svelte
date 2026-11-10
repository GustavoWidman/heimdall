<!--
	One task on the board. Tap switches to it. Pressing for 400 ms juggles it in, or lets go
	of it when it is already part of a juggle; a ring fills while you press, and while its
	number key is down. Shift with a click or Enter does the same without holding.
-->
<script lang="ts">
	import type { BoardRow } from '#lib/app/app.svelte.ts';
	import { deadlineLabel, spent } from '#lib/ui/format.ts';
	import Iris from '#lib/ui/Iris.svelte';
	import Tally from '#lib/ui/Tally.svelte';
	import { HOLD_MS, useCtx, type Moment } from '#lib/ui/watch.svelte.ts';

	let {
		row,
		index,
		juggled,
		arranging,
		onpress,
		onedit
	}: {
		row: BoardRow;
		/** Position on the board, for the 1 to 9 shortcut hint. */
		index: number;
		/** In focus together with other tasks. */
		juggled: boolean;
		arranging: boolean;
		onpress: (mode: 'tap' | 'hold') => Moment | null;
		onedit: () => void;
	} = $props();

	const { app, watch } = useCtx();
	const task = $derived(row.task);
	const latest = $derived(watch.moment?.entered === row.task.id);
	const zone = $derived(app.settings.timeZone);

	/** Closed time plus the open stretch; only the task in focus reads the ticking clock. */
	const ms = $derived.by(() => {
		const tail = app.today.view.tail;
		return row.day.ms + (row.inFocus && tail ? Math.max(0, app.now - tail.start) : 0);
	});
	const due = $derived(task.deadline === null ? null : deadlineLabel(task.deadline, app.now, zone));

	let el: HTMLElement | undefined = $state();
	let pressing = $state(false);
	let fired = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let origin = { x: 0, y: 0 };
	let ripples = $state(0);

	function act(mode: 'tap' | 'hold') {
		const moment = onpress(mode);
		const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (moment) {
			ripples++;
			if (!calm)
				el?.animate([{ transform: 'scale(.975)' }, { transform: 'none' }], {
					duration: 500,
					easing: 'cubic-bezier(.2,.9,.25,1)'
				});
		} else if (!calm) {
			el?.animate(
				[
					{ transform: 'none' },
					{ transform: 'translateX(-3px)' },
					{ transform: 'translateX(3px)' },
					{ transform: 'none' }
				],
				{ duration: 320 }
			);
		}
	}

	function cancel() {
		clearTimeout(timer);
		pressing = false;
	}

	function onpointerdown(e: PointerEvent) {
		fired = false;
		if (arranging || e.button !== 0) return;
		origin = { x: e.clientX, y: e.clientY };
		pressing = true;
		timer = setTimeout(() => {
			pressing = false;
			fired = true;
			act('hold');
		}, HOLD_MS);
	}

	function onpointermove(e: PointerEvent) {
		if (pressing && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 10) cancel();
	}

	function onclick(e: MouseEvent) {
		if (fired) {
			fired = false;
			return;
		}
		if (arranging) onedit();
		else act(e.shiftKey ? 'hold' : 'tap');
	}

	function onkeydown(e: KeyboardEvent) {
		if (arranging || !e.shiftKey || (e.key !== 'Enter' && e.key !== ' ')) return;
		e.preventDefault();
		act('hold');
	}
</script>

<div
	class="row hue"
	class:on={row.inFocus && !juggled}
	class:juggled
	class:done={task.status !== 'active'}
	style:--h={task.hue}
	bind:this={el}
>
	<button
		class="hit"
		aria-pressed={arranging ? undefined : row.inFocus}
		aria-keyshortcuts={index < 9 ? `${index + 1} Shift+${index + 1}` : undefined}
		{onpointerdown}
		{onpointermove}
		onpointerup={cancel}
		onpointercancel={cancel}
		onpointerleave={cancel}
		oncontextmenu={(e) => e.preventDefault()}
		{onclick}
		{onkeydown}
	>
		<span class="kn mono" aria-hidden="true">{index < 9 ? index + 1 : ''}</span>
		<span class="ic">
			<Iris hues={[task.hue]} open={row.inFocus} size={30} />
			<svg
				class="hold"
				class:pressing={pressing || watch.keyed === task.id}
				viewBox="0 0 40 40"
				aria-hidden="true"
			>
				<circle cx="20" cy="20" r="18.5" pathLength="1" />
			</svg>
			{#key ripples}{#if ripples}<span class="ripple" aria-hidden="true"></span>{/if}{/key}
		</span>
		<span class="t">
			<span class="n">{task.title}</span>
			<span class="m">
				{#if task.status === 'done'}
					<span class="tag">done</span>
				{/if}
				{#if due}<span class:near={due.near}>{due.text}</span>{/if}
				{#if task.longRunning}<span class="lt">long-term</span>{/if}
				{#if task.deadline === null && !task.longRunning && task.status === 'active'}
					<span>anytime</span>
				{/if}
				{#if !row.planned}<span class="tag">unplanned</span>{/if}
				{#if juggled}<span class="jb">juggling</span>{/if}
			</span>
		</span>
		<span class="r">
			<span class="tm mono">{ms < 60_000 ? '·' : spent(ms)}</span>
			<Tally count={row.day.ticks} hue={task.hue} seed={task.id} live={latest} />
		</span>
		<span class="visually-hidden">
			{row.inFocus ? 'in focus. ' : ''}{arranging ? 'edit' : 'hold to juggle'}
		</span>
	</button>
	{#if !arranging}
		<span class="acts">
			<button class="act" tabindex="-1" onclick={() => act('hold')}>
				{juggled ? 'let go' : 'juggle'}
			</button>
			<button class="act" onclick={onedit} aria-label="edit {task.title}">edit</button>
		</span>
	{/if}
</div>

<style>
	.row {
		position: relative;
		border-radius: 12px;
	}
	.row::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 12px;
		background: var(--c-soft);
		opacity: 0;
		transition: opacity 0.35s;
		pointer-events: none;
	}
	.row.on::before {
		opacity: 0.6;
	}
	.row.juggled::before {
		opacity: 0.45;
	}
	.hit {
		position: relative;
		display: grid;
		grid-template-columns: auto auto 1fr auto;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 64px;
		padding: 10px 6px 10px 4px;
		text-align: left;
		border-radius: 12px;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.kn {
		display: none;
	}
	.ic {
		position: relative;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
	}
	.hold {
		position: absolute;
		inset: 0;
		width: 40px;
		height: 40px;
		transform: rotate(-90deg);
		pointer-events: none;
	}
	.hold circle {
		fill: none;
		stroke: var(--c);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		opacity: 0;
		transition:
			stroke-dashoffset 0.1s,
			opacity 0.1s;
	}
	.hold.pressing circle {
		stroke-dashoffset: 0;
		opacity: 1;
		transition:
			stroke-dashoffset 0.3s linear 0.1s,
			opacity 0.1s 0.1s;
	}
	.ripple {
		position: absolute;
		inset: 5px;
		border-radius: 50%;
		border: 1.5px solid var(--c);
		pointer-events: none;
		animation: ripple 0.7s var(--snap) forwards;
	}
	@keyframes ripple {
		from {
			opacity: 0.7;
			transform: scale(0.9);
		}
		to {
			opacity: 0;
			transform: scale(2.2);
		}
	}
	.t {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.n {
		overflow: hidden;
		font-size: 15.5px;
		font-weight: 480;
		letter-spacing: -0.01em;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.on .n,
	.juggled .n {
		font-weight: 560;
	}
	.done .n {
		color: var(--ink-3);
		text-decoration: line-through;
		text-decoration-color: var(--rule);
	}
	/* One line tall and wrapping between details, so a detail that does not fit drops
	   whole onto the hidden second line instead of being cut part way. */
	.m {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
		height: 18px;
		margin-top: 2px;
		overflow: hidden;
		font-size: 12px;
		color: var(--ink-3);
		white-space: nowrap;
	}
	.m > * {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.near {
		color: var(--c-text);
	}
	.lt {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.lt::before {
		content: '';
		width: 10px;
		height: 1px;
		background: currentColor;
		box-shadow:
			0 -3px 0 currentColor,
			0 3px 0 currentColor;
		opacity: 0.7;
	}
	.tag,
	.jb {
		padding: 0 6px;
		border: 1px solid var(--rule);
		border-radius: 99px;
		font-family: var(--mono);
		font-size: 10.5px;
		line-height: 16px;
	}
	.jb {
		color: var(--ink);
	}
	.r {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		text-align: right;
	}
	.tm {
		font-size: 12.5px;
		color: var(--ink-2);
	}
	.on .tm,
	.juggled .tm {
		color: var(--ink);
	}
	.on .r,
	.juggled .r {
		--tally-ink: var(--ink);
	}

	.acts {
		display: none;
	}
	@media (hover: hover) and (pointer: fine) {
		.row:hover::before {
			opacity: 0.25;
		}
		.row.on:hover::before {
			opacity: 0.6;
		}
		.acts {
			position: absolute;
			top: 50%;
			right: 8px;
			display: flex;
			gap: 6px;
			opacity: 0;
			transform: translate(6px, -50%);
			transition:
				opacity 0.2s,
				transform 0.3s var(--spring);
			pointer-events: none;
		}
		.row:hover .acts,
		.row:has(:focus-visible) .acts {
			opacity: 1;
			transform: translate(0, -50%);
			pointer-events: auto;
		}
		/* While the actions show, the time and tally column holds their width, so the text
		   ends where they begin instead of running under them. */
		.row:hover .r,
		.row:has(:focus-visible) .r {
			min-width: 112px;
			opacity: 0;
		}
		.r {
			transition: opacity 0.15s;
		}
		.act {
			height: 30px;
			padding: 0 10px;
			border: 1px solid var(--rule);
			border-radius: 99px;
			background: var(--panel);
			font-size: 12px;
		}
		.act:hover {
			border-color: var(--ink-3);
		}
	}
	@media (min-width: 1000px) {
		.hit {
			min-height: 70px;
			padding: 12px 10px;
		}
		.kn {
			display: block;
			width: 18px;
			border: 1px solid var(--rule);
			border-radius: 4px;
			font-size: 10px;
			line-height: 16px;
			color: var(--ink-3);
			text-align: center;
		}
	}
</style>
