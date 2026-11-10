<!-- A switch that happened without a tick: log it at the time it really happened. -->
<script lang="ts">
	import type { Instant, TaskId } from '#lib/app/app.svelte.ts';
	import { clock, MINUTE, minuteOfDay } from '#lib/ui/format.ts';
	import Iris from '#lib/ui/Iris.svelte';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	let { onclose }: { onclose: () => void } = $props();

	const { app } = useCtx();
	const zone = $derived(app.settings.timeZone);
	const rows = $derived(app.today.board);

	let what: TaskId | 'rest' | null = $state(null);
	let alongside = $state(false);
	// svelte-ignore state_referenced_locally
	let time = $state(clock(app.now - 15 * MINUTE, zone));

	/** The latest instant at that clock time, today or, past midnight, the night before. */
	function instantOf(hhmm: string): Instant {
		const now = app.now;
		const [h, m] = hhmm.split(':').map(Number);
		const back = (minuteOfDay(now, zone) - (h * 60 + m) + 1440) % 1440;
		return (now - (now % MINUTE) - back * MINUTE) as Instant;
	}

	function log(e: SubmitEvent) {
		e.preventDefault();
		if (!what || !time) return;
		const at = instantOf(time);
		const d =
			what === 'rest'
				? app.do({ k: 'rest', at })
				: app.do({ k: alongside ? 'hold' : 'tap', task: what, at });
		if (d.ok) onclose();
	}
</script>

<form onsubmit={log}>
	<h2>forgot to tick</h2>
	<p class="sum">it happens. say when, and it slots into the day.</p>

	<fieldset class="fld">
		<legend class="nm">switched to</legend>
		<div class="picks">
			{#each rows as r (r.task.id)}
				<label class="pick hue" style:--h={r.task.hue}>
					<input type="radio" name="what" value={r.task.id} bind:group={what} />
					<Iris hues={[r.task.hue]} size={20} open={what === r.task.id} />
					<span>{r.task.title}</span>
				</label>
			{/each}
			<label class="pick">
				<input type="radio" name="what" value="rest" bind:group={what} />
				<Iris size={20} open={what === 'rest'} />
				<span>rest</span>
			</label>
		</div>
	</fieldset>

	<div class="fld">
		<label class="nm" for="forgot-time">at</label>
		<input id="forgot-time" class="field mono" type="time" bind:value={time} />
	</div>

	{#if what !== 'rest'}
		<label class="fld toggle">
			<span class="nm">alongside what I held</span>
			<input type="checkbox" switch bind:checked={alongside} />
		</label>
	{/if}

	<div class="acts">
		<button type="button" class="btn quiet" onclick={onclose}>cancel</button>
		<button class="btn primary" disabled={!what || !time}>log it</button>
	</div>
</form>

<style>
	h2 {
		font-size: 22px;
		font-weight: 560;
		letter-spacing: -0.02em;
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
		min-width: 0;
		padding: 16px 0;
		border: 0;
		border-bottom: 1px solid var(--rule-2);
	}
	.nm {
		font-size: 14px;
		font-weight: 520;
	}
	legend.nm {
		margin-bottom: 10px;
	}
	.field {
		max-width: 160px;
	}
	.picks {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.pick {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		max-width: 100%;
		padding: 0 14px 0 10px;
		border: 1px solid var(--rule);
		border-radius: 99px;
		font-size: 14px;
		cursor: pointer;
		transition: background-color 0.2s;
	}
	.pick span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pick:has(input:checked) {
		border-color: var(--ink);
		background: var(--c-soft, var(--panel-2));
	}
	.pick:has(input:focus-visible) {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}
	.pick input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.toggle {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}
	.toggle input {
		width: 44px;
		height: 26px;
		accent-color: var(--ink);
	}
	.acts {
		display: flex;
		gap: 10px;
		margin-top: 18px;
	}
	.acts .primary {
		flex: 1;
	}
	.btn:disabled {
		opacity: 0.4;
	}
</style>
