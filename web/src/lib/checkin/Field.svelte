<!--
	One check-in question, drawn from its registry entry. A scale or choice is one row of
	labeled cells: a tap answers, a tap on the answer clears it. Every answer is written as
	it is given; there is no save step.
-->
<script lang="ts">
	import type { CheckInKey, FieldDef } from '#lib/app/app.svelte.ts';
	import { haptic } from '#lib/ui/haptic.ts';
	import { stepNumber } from './view';

	let {
		key,
		def,
		value,
		onset
	}: {
		key: CheckInKey;
		def: FieldDef;
		value: unknown;
		onset: (value: unknown) => void;
	} = $props();

	const id = $derived(`q-${key}`);
	const answered = $derived(value !== undefined);

	function pick(v: unknown) {
		haptic(8);
		onset(v === value ? null : v);
	}

	const SLEEP_START = 7;

	function step(by: -1 | 1) {
		haptic(6);
		onset(stepNumber(key, value as number | undefined, by, SLEEP_START));
	}

	let draft = $state('');
	let typing = false;
	let pending: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (!typing) draft = typeof value === 'string' ? value : '';
	});

	function flush() {
		clearTimeout(pending);
		typing = false;
		const next = draft.trim() ? draft : null;
		if (next !== (value ?? null)) onset(next);
	}

	function oninput() {
		typing = true;
		clearTimeout(pending);
		pending = setTimeout(flush, 600);
	}
</script>

<div class="q" class:answered>
	<div class="ask">
		<span class="text" {id}>{def.question}</span>
		{#if answered && def.kind !== 'text'}
			<button class="clear" onclick={() => onset(null)} aria-label="clear {def.question}">
				clear
			</button>
		{/if}
	</div>

	{#if def.kind === 'scale' || def.kind === 'choice'}
		<div
			class="cells"
			role="group"
			aria-labelledby={id}
			style:--n={def.values.length}
		>
			{#each def.values as v, i (v)}
				<button class="cell" aria-pressed={v === value} onclick={() => pick(v)}>
					<span>{def.labels[i]}</span>
				</button>
			{/each}
		</div>
	{:else if def.kind === 'number'}
		<div class="stepper" role="group" aria-labelledby={id}>
			<button class="cell nudge" onclick={() => step(-1)} aria-label="less">
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9" /></svg>
			</button>
			<output class="mono num" aria-live="polite">
				{#if answered}{value}<small>{def.unit}</small>{:else}<span class="blank">—</span>{/if}
			</output>
			<button class="cell nudge" onclick={() => step(1)} aria-label="more">
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
			</button>
		</div>
	{:else}
		<textarea
			class="field"
			rows="3"
			maxlength={def.maxLength}
			aria-labelledby={id}
			placeholder="optional"
			bind:value={draft}
			{oninput}
			onblur={flush}
		></textarea>
	{/if}
</div>

<style>
	.q {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px 0 18px;
		border-bottom: 1px solid var(--rule-2);
	}
	.ask {
		display: flex;
		align-items: baseline;
		gap: 12px;
		min-height: 22px;
	}
	.text {
		flex: 1;
		font-size: 15px;
		line-height: 1.3;
	}
	.clear {
		flex: none;
		margin: -12px -8px -12px 0;
		padding: 12px 8px;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--ink-3);
		animation: appear 0.25s var(--snap);
	}
	.cells {
		display: grid;
		grid-template-columns: repeat(var(--n), 1fr);
		border: 1px solid var(--rule);
		border-radius: 14px;
		overflow: hidden;
	}
	.cell {
		position: relative;
		display: grid;
		place-items: center;
		min-height: 48px;
		padding: 4px 6px;
		font-size: 12.5px;
		letter-spacing: -0.01em;
		line-height: 1.15;
		color: var(--ink-2);
		text-align: center;
		isolation: isolate;
		transition: color 0.2s;
	}
	.cells .cell + .cell {
		border-left: 1px solid var(--rule-2);
	}
	.cell::before {
		content: '';
		position: absolute;
		inset: 3px;
		z-index: -1;
		border-radius: 11px;
		background: var(--ink);
		opacity: 0;
		transform: scale(0.7);
		transition:
			opacity 0.18s,
			transform 0.4s var(--spring);
	}
	.cell:active::before {
		opacity: 0.08;
		transform: scale(0.92);
	}
	.cell[aria-pressed='true'] {
		color: var(--bg);
	}
	.cell[aria-pressed='true']::before {
		opacity: 1;
		transform: none;
	}
	.cell span {
		transition: transform 0.35s var(--spring);
	}
	.cell[aria-pressed='true'] span {
		transform: scale(1.04);
	}
	.cell:focus-visible {
		outline-offset: -3px;
		border-radius: 11px;
	}
	.answered .cell:not([aria-pressed='true']) {
		color: var(--ink-3);
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.nudge {
		width: 56px;
		border: 1px solid var(--rule);
		border-radius: 14px;
	}
	.nudge svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.num {
		flex: 1;
		font-size: 24px;
		text-align: center;
	}
	.num small {
		margin-left: 2px;
		font-size: 13px;
		color: var(--ink-3);
	}
	.blank {
		color: var(--ink-4);
	}
	textarea {
		resize: vertical;
	}
	@keyframes appear {
		from {
			opacity: 0;
		}
	}
</style>
