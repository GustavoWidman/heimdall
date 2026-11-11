<!--
	Rises from the bottom once a newer build has downloaded, so taking it needs one tap
	instead of closing every window. Closing it keeps the offer under the version on the
	more screen until the next launch.
-->
<script lang="ts">
	import { backOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { update } from '#lib/app/update.svelte.ts';
</script>

{#if update.offer}
	<div
		class="popup"
		role="region"
		aria-label="new version"
		in:fly={{ y: 14, duration: 420, easing: backOut }}
		out:fly={{ y: 8, duration: 240 }}
	>
		<span class="what"><i class="dot" aria-hidden="true"></i>a new version is ready</span>
		<button class="chip" onclick={() => update.apply()}>reload</button>
		<button class="close" aria-label="not now" onclick={() => update.dismiss()}>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
		</button>
	</div>
{/if}

<style>
	.popup {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		max-width: 520px;
		padding: 6px 6px 6px 14px;
		border-radius: 16px;
		border: 1px solid var(--rule);
		background: var(--panel);
		box-shadow: var(--shadow-float);
		font-size: 13.5px;
		pointer-events: auto;
	}
	.what {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-right: auto;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ink-2);
	}
	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 99px;
		color: var(--ink-3);
		transition: background-color 0.2s;
	}
	.close svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
	}
	@media (hover: hover) {
		.close:hover {
			background: var(--panel-2);
			color: var(--ink);
		}
	}
</style>
