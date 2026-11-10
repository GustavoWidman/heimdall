<!--
	Fixing one mark: move it to the right time, say why, or void it. Every later moment of
	the day re-derives from the corrected marks.
-->
<script lang="ts">
	import { REASONS, type MarkId, type Reason } from '#lib/app/app.svelte.ts';
	import { clock, MINUTE, minuteOfDay } from '#lib/ui/format.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import { describe } from './marks';

	let { id, onclose }: { id: MarkId; onclose: () => void } = $props();

	const { app, watch } = useCtx();
	const zone = $derived(app.settings.timeZone);
	const mark = $derived(app.today.marks.find((m) => m.id === id));
	const what = $derived(mark ? describe(mark, (t) => watch.task(t)) : null);

	// svelte-ignore state_referenced_locally
	let time = $state(mark ? clock(mark.at, zone) : '');
	const moved = $derived(mark !== undefined && time !== '' && time !== clock(mark.at, zone));

	function retime() {
		if (!mark) return;
		const [h, m] = time.split(':').map(Number);
		const delta = h * 60 + m - minuteOfDay(mark.at, zone);
		app.do({ k: 'retime', mark: mark.id, at: (mark.at + delta * MINUTE) as typeof mark.at });
	}

	// Moved to another day: it is no longer today's to fix.
	$effect(() => {
		if (!mark) onclose();
	});

	function tag(r: Reason) {
		if (mark) app.do({ k: 'tag', mark: mark.id, reason: mark.reason === r ? null : r });
	}
</script>

{#if mark && what}
	<h2>
		<span class="at mono">{clock(mark.at, zone)}</span>
		{what.verb}{#if what.task}<span class="hue" style:--h={what.task.hue}>
				<i></i>{what.task.title}</span
			>{/if}
	</h2>
	{#if mark.voided}<p class="sum">voided. it no longer counts.</p>{/if}

	<div class="fld">
		<label class="nm" for="mark-time">when</label>
		<div class="inline">
			<input id="mark-time" class="field mono" type="time" bind:value={time} />
			<button class="btn quiet" disabled={!moved} onclick={retime}>move</button>
		</div>
	</div>

	{#if !mark.voided}
		<div class="fld">
			<span class="nm" id="why-label">why</span>
			<div class="chips" role="group" aria-labelledby="why-label">
				{#each REASONS as r (r)}
					<button class="chip" aria-pressed={mark.reason === r} onclick={() => tag(r)}>{r}</button>
				{/each}
			</div>
		</div>
	{/if}

	<div class="acts">
		<button
			class="btn quiet"
			onclick={() => app.do({ k: 'void', mark: mark.id, voided: !mark.voided })}
		>
			{mark.voided ? 'restore it' : 'void it'}
		</button>
		<button class="btn primary" onclick={onclose}>done</button>
	</div>
{/if}

<style>
	h2 {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px;
		font-size: 20px;
		font-weight: 540;
		letter-spacing: -0.015em;
	}
	h2 .at {
		font-size: 15px;
		font-weight: 450;
		color: var(--ink-3);
	}
	h2 span.hue {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}
	h2 i {
		width: 9px;
		height: 9px;
		border-radius: 2px;
		background: var(--c);
	}
	.sum {
		margin-top: 4px;
		font-size: 13px;
		color: var(--ink-2);
	}
	.fld {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px 0;
		border-bottom: 1px solid var(--rule-2);
	}
	.nm {
		font-size: 14px;
		font-weight: 520;
	}
	.inline {
		display: flex;
		gap: 8px;
	}
	.inline .field {
		max-width: 160px;
	}
	.inline .btn {
		min-height: 44px;
	}
	.btn:disabled {
		opacity: 0.4;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.acts {
		display: flex;
		gap: 10px;
		margin-top: 18px;
	}
	.acts .primary {
		flex: 1;
	}
</style>
