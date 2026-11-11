<!--
	What follows a gesture. After every tick: what it did, an undo, and "earlier" to say it
	really happened a few minutes ago, with "why the switch?" chips when it switched. A gentle
	note when the task just left is due soon, and an undo after ending the day. They float
	above the tab bar, so nothing underneath moves and the rest button stays reachable. The
	offer of a newer build stacks above them.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { backOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import {
		REASONS,
		type Instant,
		type MarkId,
		type Reason,
		type Task
	} from '#lib/app/app.svelte.ts';
	import { clock, MINUTE, remaining } from './format';
	import UpdatePopup from './UpdatePopup.svelte';
	import { useCtx, type Moment } from './watch.svelte';

	const ASK_MS = 4000;
	const EARLIER_MS = 6000;
	const SETTLED_MS = 1100;
	const NOTE_MS = 5200;
	const ENDED_MS = 6000;
	/** How far back "earlier" offers, in minutes from when the tick was made. */
	const BACK = [5, 10, 15, 30, 60] as const;

	const { app, watch } = useCtx();
	const zone = $derived(app.settings.timeZone);

	type Act = {
		readonly seq: number;
		readonly mark: MarkId;
		/** When the tick was made; "earlier" counts back from here. */
		readonly at: Instant;
		readonly hue: number | null;
		/** A switch asks why; anything else says what it did. */
		readonly ask: boolean;
		readonly verb: string;
		readonly what: string;
		chosen: Reason | null;
		/** Minutes moved back from `at`. */
		back: number;
		earlier: boolean;
		undone: boolean;
		/** Restarts the drain whenever the countdown does. */
		round: number;
		ms: number;
	};

	let act: Act | null = $state(null);
	let note: { readonly seq: number; readonly task: Task; readonly left: number } | null =
		$state(null);
	let ended: { readonly seq: number; readonly mark: MarkId; readonly at: number } | null =
		$state(null);
	let paused = $state(false);

	/** A dismissal that can pause while the pointer or focus is on the toast. */
	function countdown(ms: number, done: () => void) {
		let left = ms;
		let started = performance.now();
		let id: ReturnType<typeof setTimeout> | null = setTimeout(done, left);
		const t = {
			pause() {
				if (id === null) return;
				clearTimeout(id);
				id = null;
				left -= performance.now() - started;
			},
			resume() {
				if (id !== null) return;
				started = performance.now();
				id = setTimeout(done, Math.max(400, left));
			},
			cancel() {
				if (id !== null) clearTimeout(id);
				id = null;
			}
		};
		if (paused) t.pause();
		return t;
	}

	let actTimer: ReturnType<typeof countdown> | null = null;
	let noteTimer: ReturnType<typeof countdown> | null = null;
	let endedTimer: ReturnType<typeof countdown> | null = null;

	function title(id: string | undefined) {
		return (id && app.tasks.find((t) => t.id === id)?.title) || '';
	}

	/** What a tick that asks nothing says it did. */
	function said(m: Moment): { readonly verb: string; readonly what: string } {
		if (m.kind === 'start') return { verb: 'started', what: title(m.entered ?? undefined) };
		if (m.kind === 'resume') return { verb: 'back on', what: title(m.entered ?? undefined) };
		const left = m.to.k === 'working' ? m.to.tasks : [];
		return left.length === 1
			? { verb: 'just', what: title(left[0]) }
			: { verb: 'down to', what: `${left.length} tasks` };
	}

	/** Counts the act toast down again from the full `ms`, with a fresh drain. */
	function restart(current: Act, ms: number, done = () => (act = null)) {
		actTimer?.cancel();
		current.ms = ms;
		current.round++;
		actTimer = countdown(ms, () => {
			if (act === current) done();
		});
	}

	$effect(() => {
		const m = watch.moment;
		if (!m) return;
		untrack(() => {
			if (m.kind === 'off') {
				actTimer?.cancel();
				act = null;
				endedTimer?.cancel();
				ended = { seq: m.seq, mark: m.mark, at: m.at };
				endedTimer = countdown(ENDED_MS, () => (ended = null));
			} else {
				const ask = m.kind === 'switch' || m.kind === 'rest';
				const lead = m.entered ?? (m.to.k === 'working' ? m.to.tasks[0] : undefined);
				const hue = lead ? (app.tasks.find((t) => t.id === lead)?.hue ?? null) : null;
				const next: Act = {
					seq: m.seq,
					mark: m.mark,
					at: m.at,
					hue,
					ask,
					...(ask ? { verb: '', what: '' } : said(m)),
					chosen: null,
					back: 0,
					earlier: false,
					undone: false,
					round: 0,
					ms: ASK_MS
				};
				act = next;
				restart(act, ASK_MS);
			}
			if (m.dueSoon) {
				noteTimer?.cancel();
				note = { seq: m.seq, task: m.dueSoon, left: (m.dueSoon.deadline ?? m.at) - m.at };
				noteTimer = countdown(NOTE_MS, () => (note = null));
			}
		});
	});

	/** The latest the tick can move back to: just after the tick before it, or the day start. */
	const floor = $derived.by(() => {
		if (!act) return 0;
		let f: number = app.today.view.range.start;
		for (const m of app.today.marks) {
			if (!m.voided && m.id !== act.mark && m.at <= act.at && m.at > f) f = m.at;
		}
		return f;
	});
	/** The tick moved back by whole minutes; the seconds of the tap are dropped with it. */
	const backBy = (a: Act, minutes: number) =>
		(minutes === 0 ? a.at : a.at - (a.at % MINUTE) - minutes * MINUTE) as Instant;
	const fits = (minutes: number) => act !== null && backBy(act, minutes) > floor;

	function choose(reason: Reason) {
		if (!act) return;
		app.do({ k: 'tag', mark: act.mark, reason });
		act.chosen = reason;
		restart(act, SETTLED_MS);
	}

	function toggleEarlier() {
		if (!act) return;
		act.earlier = !act.earlier;
		restart(act, act.earlier ? EARLIER_MS : ASK_MS);
	}

	function goBack(minutes: number) {
		if (!act) return;
		const back = act.back === minutes ? 0 : minutes;
		const d = app.do({ k: 'retime', mark: act.mark, at: backBy(act, back) });
		if (!d.ok) return;
		act.back = back;
		restart(act, EARLIER_MS);
	}

	function undo() {
		if (!act) return;
		app.do({ k: 'void', mark: act.mark, voided: true });
		if (note?.seq === act.seq) {
			noteTimer?.cancel();
			note = null;
		}
		act.undone = true;
		restart(act, SETTLED_MS);
	}

	function reopen() {
		if (!ended) return;
		app.do({ k: 'void', mark: ended.mark, voided: true });
		endedTimer?.cancel();
		ended = null;
	}

	/** A toast on its way out takes no more taps, so they land on the one replacing it. */
	function leaving(e: Event) {
		(e.currentTarget as HTMLElement).inert = true;
	}

	function hold(on: boolean) {
		paused = on;
		for (const t of [actTimer, noteTimer, endedTimer]) {
			if (on) t?.pause();
			else t?.resume();
		}
	}
</script>

<div
	class="toasts"
	role="region"
	aria-label="after the switch"
	onpointerenter={() => hold(true)}
	onpointerleave={() => hold(false)}
	onfocusin={() => hold(true)}
	onfocusout={() => hold(false)}
>
	<UpdatePopup />
	{#if note}
		{#key note.seq}
			<div
				class="toast note hue"
				style:--h={note.task.hue}
				role="status"
				in:fly={{ y: 14, duration: 420, easing: backOut }}
				out:fly={{ y: 8, duration: 240 }}
				onoutrostart={leaving}
			>
				<i class="dot"></i>
				<span class="what"><b>{note.task.title}</b> due in <b>{remaining(note.left)}</b></span>
				<span class="aside">just so you know</span>
			</div>
		{/key}
	{/if}
	{#if ended}
		{#key ended.seq}
			<div
				class="toast ended"
				role="status"
				in:fly={{ y: 14, duration: 420, easing: backOut }}
				out:fly={{ y: 8, duration: 240 }}
				onoutrostart={leaving}
			>
				<span class="what"
					>day ended at <b class="mono">{clock(ended.at, app.settings.timeZone)}</b></span
				>
				<span class="aside">see you tomorrow</span>
				<button class="chip" onclick={reopen}>undo</button>
				<span class="drain" class:paused style:--ms="{ENDED_MS}ms"></span>
			</div>
		{/key}
	{/if}
	{#if act}
		{#key act.seq}
			<div
				class="toast act"
				class:hue={act.hue !== null}
				style:--h={act.hue}
				in:fly={{ y: 14, duration: 420, easing: backOut }}
				out:fly={{ y: 8, duration: 240 }}
				onoutrostart={leaving}
			>
				{#if act.undone || act.chosen}
					<p class="noted" role="status">
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
						{act.undone ? 'undone' : `noted · ${act.chosen}`}
					</p>
				{:else}
					<div class="head">
						{#if act.earlier}
							<span class="q" role="status">
								it began at <b class="mono">{clock(backBy(act, act.back), zone)}</b>
							</span>
						{:else if act.ask}
							<span class="q">why the switch?</span>
						{:else}
							<span class="q said"><i class="dot"></i>{act.verb} <b>{act.what}</b></span>
						{/if}
						{#if fits(BACK[0])}
							<button class="tool" aria-pressed={act.earlier} onclick={toggleEarlier}>
								<svg viewBox="0 0 16 16" aria-hidden="true"
									><path d="M3.2 8a5 5 0 1 0 1.4-3.5M3 2.5v2.6h2.6M8 5.2V8l2 1.3" /></svg
								>earlier
							</button>
						{/if}
						<button class="tool" onclick={undo}>
							<svg viewBox="0 0 16 16" aria-hidden="true"
								><path d="M4.5 6.5h5.5a3 3 0 0 1 0 6H7M4.5 6.5L7 4M4.5 6.5L7 9" /></svg
							>undo
						</button>
					</div>
					{#if act.earlier}
						<div class="row" role="group" aria-label="how much earlier">
							{#each BACK as b (b)}
								<button
									class="chip mono"
									aria-pressed={act.back === b}
									disabled={!fits(b)}
									onclick={() => goBack(b)}
								>
									−{b < 60 ? `${b}m` : '1h'}
								</button>
							{/each}
						</div>
					{:else if act.ask}
						<div class="row" role="group" aria-label="why the switch?">
							{#each REASONS as r (r)}
								<button class="chip" onclick={() => choose(r)}>{r}</button>
							{/each}
						</div>
					{/if}
					{#key act.round}
						<span class="drain" class:paused style:--ms="{act.ms}ms"></span>
					{/key}
				{/if}
			</div>
		{/key}
	{/if}
</div>

<style>
	.toasts {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--tab-h) + var(--safe-bottom) + 12px);
		z-index: 20;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 0 var(--gutter);
		pointer-events: none;
	}
	.toast {
		position: relative;
		width: 100%;
		max-width: 520px;
		overflow: hidden;
		border-radius: 16px;
		border: 1px solid var(--rule);
		background: var(--panel);
		box-shadow: var(--shadow-float);
		pointer-events: auto;
	}
	.note {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		font-size: 13.5px;
	}
	.note .dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
	}
	.note .what {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.note b {
		font-weight: 560;
	}
	.note .aside {
		flex: none;
		margin-left: auto;
		font-size: 12px;
		color: var(--ink-3);
	}
	.ended {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 8px 8px 16px;
		font-size: 13.5px;
	}
	.ended b {
		font-weight: 500;
	}
	.ended .aside {
		margin-left: auto;
		font-size: 12px;
		color: var(--ink-3);
	}
	.ended .chip {
		padding: 0 16px;
	}
	.act .head {
		display: flex;
		align-items: center;
		gap: 2px;
		min-height: 48px;
		padding: 2px 4px 0 14px;
	}
	.act .q {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		margin-right: auto;
		overflow: hidden;
		font-size: 12.5px;
		color: var(--ink-2);
		white-space: nowrap;
	}
	.act .q b {
		overflow: hidden;
		font-weight: 560;
		color: var(--ink);
		text-overflow: ellipsis;
	}
	.act .q b.mono {
		font-weight: 500;
	}
	.act .dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c, var(--ink-3));
	}
	.act:not(:has(.row)) .head {
		padding-bottom: 4px;
	}
	.tool {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 5px;
		min-height: 44px;
		padding: 0 10px;
		border-radius: 99px;
		font-size: 13px;
		color: var(--ink-2);
		transition:
			background-color 0.2s,
			color 0.2s,
			transform 0.3s var(--spring);
	}
	.tool:active {
		transform: scale(0.94);
	}
	.tool[aria-pressed='true'] {
		background: var(--c-soft, var(--panel-2));
		color: var(--ink);
	}
	.tool svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@media (hover: hover) {
		.tool:hover {
			background: var(--panel-2);
			color: var(--ink);
		}
	}
	.act .row {
		display: flex;
		gap: 6px;
		padding: 0 10px 12px;
	}
	.act .chip {
		flex: 1;
		padding: 0 8px;
		font-size: 13.5px;
	}
	.act .chip:disabled {
		opacity: 0.35;
	}
	.drain {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 2px;
		background: var(--c, var(--ink-3));
		opacity: 0.8;
		transform-origin: 0 50%;
		animation: drain var(--ms) linear forwards;
	}
	.drain.paused {
		animation-play-state: paused;
	}
	@keyframes drain {
		to {
			transform: scaleX(0);
		}
	}
	.noted {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 62px;
		padding: 0 16px;
		font-size: 13.5px;
		color: var(--ink-2);
	}
	.noted svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: var(--c, var(--ink));
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
