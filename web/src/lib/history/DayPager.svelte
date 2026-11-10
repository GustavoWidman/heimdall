<!--
	Days side by side: the day shown with its neighbours rendered just off screen, so a
	swipe drags real content and never waits. The track follows the finger, then settles
	onto the next day or springs back. Once settled, the neighbour becomes the day shown in
	the same frame the track returns to zero, so nothing jumps.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { DayKey } from '#lib/app/app.svelte.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import { addDays } from './period';

	let {
		day,
		last,
		onsettle,
		panel
	}: {
		day: DayKey;
		/** The newest day there is; nothing is offered past it. */
		last: DayKey;
		onsettle: (day: DayKey) => void;
		panel: Snippet<[DayKey, boolean]>;
	} = $props();

	const { app } = useCtx();

	let shown = $derived(day);
	let width = $state(0);
	/** Air between days while one slides over the other. */
	const GAP = 40;
	let dx = $state(0);
	type Phase = 'idle' | 'drag' | 'settle';
	let phase: Phase = $state('idle');
	let settleEase = $state('var(--snap)');

	const panes = $derived(
		[-1, 0, 1].flatMap((i) => {
			const d = addDays(shown, i);
			return d > last ? [] : [{ d, i }];
		})
	);

	// Two days out are read too, so a second quick swipe also lands on a loaded day.
	$effect(() => {
		void app.day(addDays(shown, -2));
		if (addDays(shown, 2) <= last) void app.day(addDays(shown, 2));
	});

	const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

	let track: HTMLElement;
	let fallback: ReturnType<typeof setTimeout> | undefined;

	function finish(dir: -1 | 0 | 1) {
		clearTimeout(fallback);
		if (dir !== 0) {
			shown = addDays(shown, dir);
			onsettle(shown);
		}
		dx = 0;
		phase = 'idle';
	}

	/** Slide to the neighbour in `dir`, or back to rest with 0. */
	function settle(dir: -1 | 0 | 1) {
		const target = -dir * (width + GAP);
		if (reduced() || Math.abs(dx - target) < 1 || width === 0) return finish(dir);
		settleEase = dir === 0 ? 'var(--spring)' : 'var(--snap)';
		phase = 'settle';
		dx = target;
		const done = (e: TransitionEvent) => {
			if (e.target !== track) return;
			track.removeEventListener('transitionend', done);
			finish(dir);
		};
		track.addEventListener('transitionend', done);
		fallback = setTimeout(() => {
			track.removeEventListener('transitionend', done);
			finish(dir);
		}, 700);
	}

	/** Step one day, as the arrows and keys do. */
	export function step(dir: -1 | 1) {
		if (phase === 'settle') return;
		if (dir === 1 && shown >= last) return;
		settle(dir);
	}

	type Drag = {
		id: number;
		x: number;
		y: number;
		axis: 'x' | 'y' | null;
		samples: [number, number][];
	};
	let drag: Drag | null = null;
	let dragged = false;

	function onpointerdown(e: PointerEvent) {
		if (e.pointerType === 'mouse' || phase === 'settle' || !e.isPrimary) return;
		drag = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, samples: [] };
		dragged = false;
	}

	function onpointermove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.id) return;
		const mx = e.clientX - drag.x;
		const my = e.clientY - drag.y;
		if (drag.axis === null) {
			if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my) * 1.2) {
				drag.axis = 'x';
				drag.x = e.clientX;
				// Capture only keeps the drag when the finger leaves the track; a pointer
				// already gone (released mid-frame) throws, and the drag works without it.
				try {
					track.setPointerCapture(e.pointerId);
				} catch {
					/* see above */
				}
				phase = 'drag';
				dragged = true;
			} else if (Math.abs(my) > 8) {
				drag = null;
			}
			return;
		}
		const off = e.clientX - drag.x;
		// Past the newest day there is nothing to show, so the track resists instead.
		dx = off < 0 && shown >= last ? off * 0.25 : off;
		drag.samples.push([e.timeStamp, e.clientX]);
		if (drag.samples.length > 6) drag.samples.shift();
	}

	function onpointerup(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.id) return;
		const d = drag;
		drag = null;
		if (d.axis !== 'x') return;
		const [t0, x0] = d.samples[0] ?? [e.timeStamp, e.clientX];
		const v = e.timeStamp > t0 ? (e.clientX - x0) / (e.timeStamp - t0) : 0;
		const far = width * 0.22;
		let dir: -1 | 0 | 1 = 0;
		if ((dx < -far || v < -0.45) && shown < last) dir = 1;
		else if (dx > far || v > 0.45) dir = -1;
		settle(dir);
	}

	function onpointercancel(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.id) return;
		const wasX = drag.axis === 'x';
		drag = null;
		if (wasX) settle(0);
	}

	/** A swipe that ends over a link must not also follow it. */
	function onclickcapture(e: MouseEvent) {
		if (!dragged) return;
		dragged = false;
		e.preventDefault();
		e.stopPropagation();
	}
</script>

<div class="pager">
	<div
		role="group"
		aria-label="days, swipe left or right for others"
		class="track"
		class:settling={phase === 'settle'}
		style:transform="translate3d({dx}px,0,0)"
		style:--ease={settleEase}
		bind:this={track}
		bind:clientWidth={width}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		{onpointercancel}
		{onclickcapture}
	>
		{#each panes as p (p.d)}
			<div
				class="pane"
				class:side={p.i !== 0}
				style:transform={p.i === 0 ? null : `translate3d(calc(${p.i * 100}% + ${p.i * GAP}px),0,0)`}
				inert={p.i !== 0}
				aria-hidden={p.i !== 0 ? 'true' : undefined}
			>
				{@render panel(p.d, p.i === 0)}
			</div>
		{/each}
	</div>
</div>

<style>
	.pager {
		/* Clipped both ways, so a taller neighbour never lengthens the page. */
		overflow: clip;
		/* The clip sits in the gutter, so content at the edges (hour labels, focus rings) shows. */
		margin: 0 calc(-1 * var(--gutter));
		padding: 0 var(--gutter);
	}
	.track {
		position: relative;
		touch-action: pan-y;
		will-change: transform;
	}
	.track.settling {
		transition: transform 0.42s var(--ease);
	}
	.pane {
		position: relative;
	}
	.pane.side {
		position: absolute;
		inset: 0 0 auto 0;
	}
</style>
