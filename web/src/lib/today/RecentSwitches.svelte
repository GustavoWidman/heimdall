<!-- The latest marks, newest first. Tapping one opens it for fixing. -->
<script lang="ts">
	import type { Mark } from '#lib/app/app.svelte.ts';
	import { clock } from '#lib/ui/format.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import { describe } from './marks';

	let {
		limit = 8,
		onopen,
		onforgot
	}: { limit?: number; onopen: (mark: Mark) => void; onforgot: () => void } = $props();

	const { app, watch } = useCtx();
	const zone = $derived(app.settings.timeZone);
	const recent = $derived(app.today.marks.slice(-limit).reverse());
</script>

<section class="recent">
	<div class="head">
		<h2 class="label">recent switches</h2>
		<button class="forgot" onclick={onforgot}>forgot to tick?</button>
	</div>
	{#if recent.length === 0}
		<p class="empty">nothing yet today.</p>
	{:else}
		<ul>
			{#each recent as m (m.id)}
				{@const d = describe(m, (id) => watch.task(id))}
				<li>
					<button class="entry" class:voided={m.voided} onclick={() => onopen(m)}>
						<span class="at mono">{clock(m.at, zone)}</span>
						<span class="who">
							{#if d.task}
								<i class="hue" style:--h={d.task.hue}></i>
								{#if m.gesture.k !== 'tap'}<span class="verb">{d.verb}</span>{/if}
								<span class="name">{d.task.title}</span>
							{:else}
								<span class="verb">{d.verb}</span>
							{/if}
						</span>
						<span class="why mono" class:none={!m.reason}>
							{m.voided ? 'voided' : (m.reason ?? '·')}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 2px 4px;
	}
	h2 {
		font-weight: 400;
	}
	.forgot {
		min-height: 36px;
		padding: 0 4px;
		font-size: 12.5px;
		color: var(--ink-2);
		text-decoration: underline;
		text-decoration-color: var(--rule);
		text-underline-offset: 3px;
	}
	.empty {
		padding: 12px 2px;
		font-size: 13px;
		color: var(--ink-3);
	}
	ul {
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.entry {
		display: grid;
		grid-template-columns: 44px 1fr auto;
		gap: 10px;
		align-items: center;
		width: 100%;
		min-height: 44px;
		padding: 0 2px;
		border-bottom: 1px solid var(--rule-2);
		font-size: 13.5px;
		text-align: left;
	}
	.at {
		font-size: 11.5px;
		color: var(--ink-3);
	}
	.who {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	.who i {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: var(--c);
	}
	.verb {
		color: var(--ink-3);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.voided .who,
	.voided .at {
		text-decoration: line-through;
		text-decoration-color: var(--ink-3);
		opacity: 0.55;
	}
	.why {
		padding: 0 7px;
		border: 1px solid var(--rule);
		border-radius: 99px;
		font-size: 10.5px;
		line-height: 17px;
		color: var(--ink-2);
	}
	.why.none {
		border-color: transparent;
		color: var(--ink-3);
	}
	@media (hover: hover) {
		.entry:hover {
			background: var(--panel-2);
		}
	}
</style>
