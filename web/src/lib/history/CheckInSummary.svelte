<!-- What a day's check-in said, in its own words, with the way to change it. -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { CheckIn, DayKey } from '#lib/app/app.svelte.ts';
	import { CHECKIN_FIELDS, CHECKIN_KEYS, type CheckInKey } from '../domain/checkin';

	let { day, checkIn }: { day: DayKey; checkIn: CheckIn } = $props();

	const NAMES: Partial<Record<CheckInKey, string>> = {
		sleepQuality: 'sleep',
		sleepHours: 'slept',
		switchOff: 'switched off'
	};

	function shown(key: CheckInKey, v: unknown): string {
		const f = CHECKIN_FIELDS[key];
		if (f.kind === 'number') return `${v}${f.unit}`;
		if (f.kind === 'text') return String(v);
		return f.labels[(f.values as readonly unknown[]).indexOf(v)] ?? String(v);
	}

	const answers = $derived(
		CHECKIN_KEYS.filter((k) => k !== 'note' && checkIn[k] !== undefined).map((k) => ({
			key: k,
			name: NAMES[k] ?? k,
			value: shown(k, checkIn[k])
		}))
	);
	const href = $derived(resolve('/checkin/[day]', { day }));
</script>

<section class="checkin" aria-label="check-in">
	<div class="top">
		<h2 class="label">check-in</h2>
		<a class="edit" {href}>{answers.length || checkIn.note ? 'edit' : 'add one'}</a>
	</div>
	{#if answers.length === 0 && !checkIn.note}
		<p class="empty">no check-in for this day.</p>
	{:else}
		<dl>
			{#each answers as a (a.key)}
				<div>
					<dt>{a.name}</dt>
					<dd>{a.value}</dd>
				</div>
			{/each}
		</dl>
		{#if checkIn.note}<p class="note">{checkIn.note}</p>{/if}
	{/if}
</section>

<style>
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 2px;
	}
	h2 {
		font-weight: 400;
	}
	.edit {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 4px;
		font-size: 12.5px;
		color: var(--ink-2);
		text-decoration: underline;
		text-decoration-color: var(--rule);
		text-underline-offset: 3px;
	}
	.empty {
		padding: 12px 2px;
		border-top: 1px solid var(--rule);
		font-size: 13px;
		color: var(--ink-3);
	}
	dl {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		column-gap: 16px;
		border-top: 1px solid var(--rule);
	}
	dl div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		padding: 7px 2px;
		border-bottom: 1px solid var(--rule-2);
		font-size: 13.5px;
	}
	dt {
		color: var(--ink-3);
	}
	dd {
		text-align: right;
	}
	.note {
		padding: 10px 2px 0;
		font-size: 13.5px;
		color: var(--ink-2);
		white-space: pre-line;
	}
</style>
