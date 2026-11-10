<!--
	The head of a look-back screen: what span is shown, and the way to the one before and
	after it, by the arrow buttons or the left and right keys.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';

	let {
		title,
		kicker,
		prev,
		next,
		noun,
		onstep,
		children
	}: {
		title: Snippet | string;
		kicker?: Snippet;
		/** Where the arrows lead. A null `next` is the future, which has nothing to show. */
		prev: string;
		next: string | null;
		/** What one step is, for the arrow labels: `day`, `week`. */
		noun: string;
		/** Takes over the step from plain navigation, as the day pager does to slide. */
		onstep?: (dir: -1 | 1) => void;
		children?: Snippet;
	} = $props();

	function step(dir: -1 | 1, e?: Event) {
		const href = dir < 0 ? prev : next;
		if (!href) return;
		if (onstep) {
			e?.preventDefault();
			onstep(dir);
		} else if (!e) void goto(href, { replace: true, reset: false });
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		const t = e.target as HTMLElement | null;
		if (t?.closest('input, textarea, select, [contenteditable], [data-own-arrows]')) return;
		if (document.querySelector('dialog[open]')) return;
		e.preventDefault();
		step(e.key === 'ArrowLeft' ? -1 : 1);
	}
</script>

<svelte:window {onkeydown} />

<header class="head">
	<div class="what">
		{#if kicker}<p class="label kicker">{@render kicker()}</p>{/if}
		<h1>
			{#if typeof title === 'string'}{title}{:else}{@render title()}{/if}
		</h1>
	</div>
	<div class="tools">
		{@render children?.()}
		<a
			class="arrow"
			href={prev}
			aria-label="previous {noun}"
			aria-keyshortcuts="ArrowLeft"
			data-sveltekit-replacestate
			data-sveltekit-reset="false"
			onclick={(e) => step(-1, e)}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5" /></svg>
		</a>
		{#if next}
			<a
				class="arrow"
				href={next}
				aria-label="next {noun}"
				aria-keyshortcuts="ArrowRight"
				data-sveltekit-replacestate
				data-sveltekit-reset="false"
				onclick={(e) => step(1, e)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>
			</a>
		{:else}
			<span class="arrow off" aria-hidden="true">
				<svg viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5" /></svg>
			</span>
		{/if}
	</div>
</header>

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 0 12px;
		border-bottom: 1px solid var(--rule);
	}
	.what {
		min-width: 0;
	}
	.kicker {
		display: flex;
		gap: 10px;
		margin-bottom: 2px;
	}
	h1 {
		font-size: 22px;
		font-weight: 560;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}
	.tools {
		display: flex;
		align-items: center;
		flex: none;
		margin-right: -10px;
	}
	.arrow {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		color: var(--ink-2);
		transition:
			transform 0.3s var(--spring),
			background-color 0.2s;
	}
	.arrow:hover {
		background: var(--panel-2);
	}
	.arrow:active {
		transform: scale(0.9);
	}
	.arrow.off {
		color: var(--ink-4);
	}
	.arrow.off:hover {
		background: none;
	}
	svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@media (min-width: 1000px) {
		.head {
			padding: 18px 0 14px;
		}
		h1 {
			font-size: 28px;
		}
	}
</style>
