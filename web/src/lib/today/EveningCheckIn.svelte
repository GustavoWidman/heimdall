<!-- In the evening, while today's check-in is blank, a quiet way into it. -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { isEvening } from '#lib/checkin/view.ts';
	import { minuteOfDay } from '#lib/ui/format.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	const { app } = useCtx();
	const show = $derived(
		Object.keys(app.today.checkIn).length === 0 &&
			isEvening(minuteOfDay(app.now, app.settings.timeZone), app.settings.dayStartHour)
	);
</script>

{#if show}
	<a class="evening" href={resolve('/checkin')}>
		<svg viewBox="0 0 24 24" aria-hidden="true"
			><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" /></svg
		>
		<span class="what">
			<span>how did today feel?</span>
			<span class="label">a short check-in, under a minute</span>
		</span>
		<svg class="go" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>
	</a>
{/if}

<style>
	.evening {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		padding: 8px 14px;
		border: 1px solid var(--rule);
		border-radius: 16px;
		background: var(--panel);
		text-decoration: none;
		animation: arrive 0.5s var(--spring);
	}
	svg {
		flex: none;
		width: 20px;
		height: 20px;
		fill: none;
		stroke: var(--ink-2);
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.what {
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-size: 14.5px;
	}
	.go {
		width: 16px;
		height: 16px;
		margin-left: auto;
		stroke: var(--ink-3);
	}
	@media (max-width: 999px) {
		.evening {
			margin-bottom: 22px;
		}
	}
	@keyframes arrive {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
</style>
