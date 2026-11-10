<!--
	The day as one hour-scaled ribbon: a block per stretch of focus in the task's hue,
	juggles striped with every hue held, rest as a faint hatch. On a live day the open
	stretch grows with a breathing now marker, and a tap sends a pulse of light along the
	ribbon into the new stretch.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { DayView, Focus, TaskId } from '#lib/app/app.svelte.ts';
	import { clock, HOUR, MINUTE, minuteOfDay, spent } from './format';
	import { hueColor } from './hue';
	import type { Moment } from './watch.svelte';

	let {
		view,
		now = null,
		zone,
		hueOf,
		label = 'today',
		pulse = null
	}: {
		view: DayView;
		/** The current instant on a live day; null draws a closed day. */
		now?: number | null;
		zone: string;
		hueOf: (task: TaskId) => number;
		label?: string;
		pulse?: Moment | null;
	} = $props();

	const floorHour = (at: number) => at - (minuteOfDay(at, zone) % 60) * MINUTE - (at % MINUTE);

	const firstActive = $derived.by(() => {
		const seg = view.segments.find((s) => s.focus.k !== 'off');
		if (seg) return seg.start;
		if (view.tail && view.tail.focus.k !== 'off') return view.tail.start;
		return now ?? view.range.start;
	});
	const lastActive = $derived.by(() => {
		const seg = view.segments.findLast((s) => s.focus.k !== 'off');
		return seg ? seg.end : view.range.start;
	});

	/** The visible window: from the hour of the first activity, at least ten hours wide. */
	const firstHour = $derived(Math.max(view.range.start, floorHour(firstActive)));
	const end = $derived(
		Math.min(
			view.range.end,
			Math.max(firstHour + 10 * HOUR, floorHour(now ?? lastActive) + (now === null ? 1 : 2) * HOUR)
		)
	);
	/** Near the day's end the window would shrink, so it reaches back instead. */
	const start = $derived(Math.max(view.range.start, Math.min(firstHour, end - 10 * HOUR)));
	const pct = (at: number) => ((Math.min(Math.max(at, start), end) - start) / (end - start)) * 100;

	type Look = { readonly kind: 'one' | 'juggle' | 'rest'; readonly paint: string | null };

	function look(f: Focus): Look | null {
		if (f.k === 'off') return null;
		if (f.k === 'rest') return { kind: 'rest', paint: null };
		const hues = f.tasks.map(hueOf);
		if (hues.length === 1) return { kind: 'one', paint: hueColor(hues[0]) };
		const w = 4;
		const stops = hues.map((h, i) => `${hueColor(h)} ${i * w}px ${(i + 1) * w}px`).join(',');
		return { kind: 'juggle', paint: `repeating-linear-gradient(120deg,${stops})` };
	}

	const bars = $derived(
		view.segments.flatMap((s) => {
			const l = look(s.focus);
			if (!l || s.end <= start) return [];
			const left = pct(s.start);
			return [{ key: s.start, left, width: Math.max(0.15, pct(s.end) - left), ...l }];
		})
	);

	const tail = $derived.by(() => {
		const t = view.tail;
		const l = t && look(t.focus);
		if (!t || !l) return null;
		return { key: `${t.start}:${t.mark}`, start: t.start, left: pct(t.start), ...l };
	});
	/** How much of the tail's span up to the window's end is filled by now. */
	const grown = $derived(
		tail && now !== null ? Math.min(1, Math.max(0, (now - tail.start) / (end - tail.start))) : 0
	);

	const whys = $derived(view.transitions.filter((t) => t.reason && t.at >= start));

	const ticks = $derived.by(() => {
		const out: { at: number; hour: boolean; text: string; even: boolean }[] = [];
		for (let at = start; at <= end; at += 30 * MINUTE) {
			const m = minuteOfDay(at, zone);
			const hour = m % 60 === 0;
			out.push({ at, hour, text: clock(at, zone).slice(0, 2), even: Math.floor(m / 60) % 2 === 0 });
		}
		return out;
	});

	const totals = $derived.by(() => {
		const open = view.tail && now !== null ? Math.max(0, now - view.tail.start) : 0;
		const f = view.tail?.focus.k;
		return {
			watched: view.totals.focusMs + (f === 'working' ? open : 0),
			rest: view.totals.restMs + (f === 'rest' ? open : 0)
		};
	});

	const meta = $derived(
		[
			now === null ? null : clock(now, zone),
			`watched ${spent(totals.watched)}`,
			`rest ${spent(totals.rest)}`
		]
			.filter(Boolean)
			.join(' · ')
	);

	/** The pulse: from where this task was last held, or the ribbon's start, into now. */
	const flight = $derived.by(() => {
		const p = pulse;
		// Computed once per gesture; the clock moving on must not relaunch the flight.
		return untrack(() => {
			if (!p?.entered || now === null) return null;
			const entered = p.entered;
			const last = view.segments.findLast(
				(s) => s.focus.k === 'working' && s.focus.tasks.includes(entered)
			);
			const from = pct(last ? last.end : start);
			return { seq: p.seq, from, to: pct(p.at), hue: hueOf(entered) };
		});
	});

	const fly =
		(f: { from: number; to: number }): Attachment<HTMLElement> =>
		(el) => {
			if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
			const dot = el.querySelector<HTMLElement>('.orb');
			const burst = el.querySelector<HTMLElement>('.burst');
			if (!dot || !burst) return;
			const frames: Keyframe[] = [];
			for (let i = 0; i <= 12; i++) {
				const k = i / 12;
				frames.push({
					transform: `translateX(${f.from + (f.to - f.from) * k}%)`,
					opacity: i === 0 ? 0 : 1
				});
			}
			const ms = 450 + 6 * Math.abs(f.to - f.from);
			const travel = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.3,.1,.2,1)' });
			dot.animate(
				[{ transform: 'scale(.6)' }, { transform: 'scale(1.25)' }, { transform: 'scale(.7)' }],
				{ duration: ms }
			);
			travel.onfinish = () => {
				el.style.transform = `translateX(${f.to}%)`;
				dot.style.opacity = '0';
				burst.animate(
					[
						{ transform: 'scale(.3)', opacity: 1 },
						{ transform: 'scale(2.6)', opacity: 0 }
					],
					{ duration: 700, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' }
				);
			};
			return () => travel.cancel();
		};
</script>

<section class="ribbon" aria-label="the day so far">
	<div class="top">
		<span class="label">bifröst · <b>{label}</b></span>
		<span class="label">{meta}</span>
	</div>
	<div class="track">
		<div class="bars">
			{#each bars as b (b.key)}
				<span
					class="bar {b.kind}"
					style:left="{b.left}%"
					style:width="{b.width}%"
					style:--paint={b.paint}
				></span>
			{/each}
			{#if tail}
				{#key tail.key}
					<span class="tail" style:left="{tail.left}%" style:width="{100 - tail.left}%">
						<span class="mv" style:transform="translateX({-(1 - grown) * 100}%)">
							<span
								class="bar fill {tail.kind}"
								style:--paint={tail.paint}
								style:transform="translateX({(1 - grown) * 100}%)"
							></span>
						</span>
					</span>
				{/key}
			{/if}
		</div>
		<div class="whys" aria-hidden="true">
			{#each whys as w (w.mark)}<i style:left="{pct(w.at)}%"></i>{/each}
		</div>
		{#if now !== null}
			<span class="now" style:transform="translateX({pct(now)}%)" aria-hidden="true"></span>
		{/if}
		{#if flight}
			{#key flight.seq}
				<span class="flight hue" style:--h={flight.hue} {@attach fly(flight)} aria-hidden="true">
					<i class="orb"></i><i class="burst"></i>
				</span>
			{/key}
		{/if}
	</div>
	<div class="scale" aria-hidden="true">
		{#each ticks as t (t.at)}
			<i class:hour={t.hour} style:left="{pct(t.at)}%"></i>
			{#if t.hour}<span class:odd={!t.even} style:left="{pct(t.at)}%">{t.text}</span>{/if}
		{/each}
	</div>
</section>

<style>
	.top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
	}
	.top b {
		color: var(--ink-2);
		font-weight: 500;
	}
	.track {
		position: relative;
		height: 30px;
		border-radius: 6px;
		background: repeating-linear-gradient(90deg, transparent 0 3px, var(--rule-2) 3px 4px);
		box-shadow: inset 0 0 0 1px var(--rule-2);
		/* The now marker and the pulse translate by up to the full track width. */
		overflow-x: clip;
		overflow-clip-margin: 6px;
	}
	.bars {
		position: absolute;
		inset: 0;
		overflow: hidden;
		border-radius: 6px;
	}
	.bar {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--paint);
		border-right: 1px solid var(--bg);
	}
	.bar.rest {
		top: 10px;
		bottom: 10px;
		border-right: 0;
		background: repeating-linear-gradient(90deg, var(--ink-4) 0 1px, transparent 1px 3px);
	}
	.tail {
		position: absolute;
		top: 0;
		bottom: 0;
		overflow: hidden;
	}
	.mv {
		position: absolute;
		inset: 0;
		overflow: hidden;
		transition: transform 1s linear;
	}
	.bar.fill {
		inset: 0;
		border-right: 0;
		transition: transform 1s linear;
	}
	.bar.fill.rest {
		inset: 10px 0;
	}
	.whys {
		position: absolute;
		left: 0;
		right: 0;
		top: -6px;
		height: 3px;
		pointer-events: none;
	}
	.whys i {
		position: absolute;
		top: 0;
		width: 3px;
		height: 3px;
		margin-left: -1.5px;
		border-radius: 50%;
		background: var(--ink-3);
	}
	.now,
	.flight {
		position: absolute;
		inset: -6px 0 -4px;
		pointer-events: none;
	}
	.now {
		transition: transform 1s linear;
	}
	.now::before {
		content: '';
		position: absolute;
		left: -0.75px;
		top: 0;
		bottom: 0;
		width: 1.5px;
		background: var(--ink);
	}
	.now::after {
		content: '';
		position: absolute;
		left: -4px;
		top: -4px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ink);
		animation: breathe 2.4s ease-in-out infinite;
	}
	.flight {
		inset: 0;
		z-index: 2;
	}
	.orb,
	.burst {
		position: absolute;
		left: -7px;
		top: 50%;
		width: 14px;
		height: 14px;
		margin-top: -7px;
		border-radius: 50%;
	}
	.orb {
		background: #fff;
		box-shadow:
			0 0 12px 4px var(--c),
			0 0 30px 10px color-mix(in oklch, var(--c) 60%, transparent);
	}
	.burst {
		opacity: 0;
		border: 2px solid var(--c);
	}
	.scale {
		position: relative;
		height: 22px;
		margin-top: 3px;
	}
	.scale i {
		position: absolute;
		top: 0;
		width: 1px;
		height: 4px;
		background: var(--ink-4);
	}
	.scale i.hour {
		height: 7px;
		background: var(--ink-3);
	}
	.scale span {
		position: absolute;
		top: 9px;
		transform: translateX(-50%);
		font-family: var(--mono);
		font-size: 10px;
		color: var(--ink-3);
	}
	.scale span.odd {
		display: none;
	}
	@media (min-width: 1000px) {
		.track {
			height: 44px;
		}
		.bar.rest,
		.bar.fill.rest {
			top: 16px;
			bottom: 16px;
		}
		.scale span.odd {
			display: block;
		}
	}
</style>
