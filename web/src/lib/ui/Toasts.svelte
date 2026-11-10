<!--
	What follows a gesture: "why the switch?" chips for about four seconds, a gentle note
	when the task just left is due soon, and an undo after ending the day. Both float above the tab bar, so nothing
	underneath moves and the rest button stays reachable.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { backOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { REASONS, type MarkId, type Reason, type Task } from '#lib/app/app.svelte.ts';
	import { clock, remaining } from './format';
	import { useCtx } from './watch.svelte';

	const ASK_MS = 4000;
	const NOTE_MS = 5200;
	const ENDED_MS = 6000;

	const { app, watch } = useCtx();

	type Ask = {
		readonly seq: number;
		readonly mark: MarkId;
		readonly hue: number | null;
		chosen: Reason | null;
	};

	let ask: Ask | null = $state(null);
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
		return {
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
	}

	let askTimer: ReturnType<typeof countdown> | null = null;
	let noteTimer: ReturnType<typeof countdown> | null = null;
	let endedTimer: ReturnType<typeof countdown> | null = null;

	$effect(() => {
		const m = watch.moment;
		if (!m) return;
		untrack(() => {
			if (m.kind === 'switch' || m.kind === 'rest') {
				askTimer?.cancel();
				const entered = m.entered ? app.tasks.find((t) => t.id === m.entered) : undefined;
				ask = { seq: m.seq, mark: m.mark, hue: entered?.hue ?? null, chosen: null };
				paused = false;
				askTimer = countdown(ASK_MS, () => (ask = null));
			}
			if (m.kind === 'off') {
				endedTimer?.cancel();
				ended = { seq: m.seq, mark: m.mark, at: m.at };
				endedTimer = countdown(ENDED_MS, () => (ended = null));
			}
			if (m.dueSoon) {
				noteTimer?.cancel();
				note = { seq: m.seq, task: m.dueSoon, left: (m.dueSoon.deadline ?? m.at) - m.at };
				noteTimer = countdown(NOTE_MS, () => (note = null));
			}
		});
	});

	function choose(reason: Reason) {
		if (!ask) return;
		const current = ask;
		app.do({ k: 'tag', mark: current.mark, reason });
		current.chosen = reason;
		askTimer?.cancel();
		askTimer = countdown(1100, () => {
			if (ask === current) ask = null;
		});
	}

	function reopen() {
		if (!ended) return;
		app.do({ k: 'void', mark: ended.mark, voided: true });
		endedTimer?.cancel();
		ended = null;
	}

	function hold(on: boolean) {
		paused = on;
		for (const t of [askTimer, noteTimer, endedTimer]) {
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
	{#if note}
		{#key note.seq}
			<div
				class="toast note hue"
				style:--h={note.task.hue}
				role="status"
				in:fly={{ y: 14, duration: 420, easing: backOut }}
				out:fly={{ y: 8, duration: 240 }}
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
	{#if ask}
		{#key ask.seq}
			<div
				class="toast why"
				class:hue={ask.hue !== null}
				style:--h={ask.hue}
				in:fly={{ y: 14, duration: 420, easing: backOut }}
				out:fly={{ y: 8, duration: 240 }}
			>
				{#if ask.chosen}
					<p class="noted" role="status">
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
						noted · {ask.chosen}
					</p>
				{:else}
					<div class="row" role="group" aria-label="why the switch?">
						<span class="q">why the switch?</span>
						{#each REASONS as r (r)}
							<button class="chip" onclick={() => choose(r)}>{r}</button>
						{/each}
					</div>
					<span class="drain" class:paused style:--ms="{ASK_MS}ms"></span>
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
	.why .row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 8px 10px 14px;
	}
	.why .q {
		margin-right: auto;
		font-size: 12.5px;
		color: var(--ink-2);
		white-space: nowrap;
	}
	.why .chip {
		padding: 0 12px;
		font-size: 13.5px;
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
	@media (max-width: 520px) {
		.why .row {
			flex-wrap: wrap;
			padding: 10px 10px 12px;
		}
		.why .q {
			flex-basis: 100%;
			padding: 0 4px 2px;
		}
		.why .chip {
			flex: 1;
		}
	}
</style>
