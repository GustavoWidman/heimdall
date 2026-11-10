<!-- Deadlines in the next six hours, as pins on a gauge and as a list. -->
<script lang="ts">
	import { clock, HOUR, remaining } from '#lib/ui/format.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	const SPAN = 6 * HOUR;

	const { app } = useCtx();
	const zone = $derived(app.settings.timeZone);
	const now = $derived(Math.floor(app.now / 60_000) * 60_000);
	const due = $derived(
		app.tasks
			.filter((t) => t.status === 'active' && t.deadline !== null)
			.map((t) => ({ task: t, left: (t.deadline as number) - now }))
			.filter((d) => d.left > 0 && d.left < SPAN)
			.sort((a, b) => a.left - b.left)
	);
</script>

<section class="horizon" aria-label="on the horizon">
	<div class="head">
		<h2 class="label">on the horizon</h2>
		<span class="label">next 6h</span>
	</div>
	<div class="gauge" aria-hidden="true">
		{#each due as d (d.task.id)}
			<span
				class="pin hue"
				class:near={d.left < 3 * HOUR}
				style:--h={d.task.hue}
				style:left="{(d.left / SPAN) * 100}%"><i></i></span
			>
		{/each}
	</div>
	{#if due.length === 0}
		<p class="clear">a clear horizon.</p>
	{:else}
		<ul>
			{#each due as d (d.task.id)}
				<li class="hue" style:--h={d.task.hue}>
					<i></i><span class="name">{d.task.title}</span>
					<span class="mono">{clock(d.task.deadline as number, zone)} · {remaining(d.left)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.horizon {
		padding: 18px 18px 10px;
		border: 1px solid var(--rule-2);
		border-radius: 16px;
		background: var(--panel);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 10px;
	}
	h2 {
		font-weight: 400;
	}
	.gauge {
		position: relative;
		height: 34px;
		border-top: 1px solid var(--rule);
		background: repeating-linear-gradient(90deg, var(--rule) 0 1px, transparent 1px calc(100% / 6))
			0 0 / 100% 6px no-repeat;
	}
	.pin {
		position: absolute;
		top: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		transform: translateX(-50%);
	}
	.pin::before {
		content: '';
		width: 1px;
		height: 12px;
		background: var(--c);
	}
	.pin i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
		box-shadow: 0 0 0 3px var(--panel);
	}
	.pin.near i {
		animation: breathe 2.4s ease-in-out infinite;
	}
	.clear {
		padding: 4px 0 8px;
		font-size: 13px;
		color: var(--ink-3);
	}
	ul {
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: 10px 1fr auto;
		gap: 10px;
		align-items: center;
		padding: 7px 0;
		border-bottom: 1px solid var(--rule-2);
		font-size: 13px;
	}
	li:last-child {
		border-bottom: 0;
	}
	li i {
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: var(--c);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	li .mono {
		font-size: 12px;
		color: var(--ink-2);
	}
</style>
