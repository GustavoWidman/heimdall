<!--
	Where sync stands, shown only when it needs a look: signed out, or the server out of
	reach. Counts the changes still waiting on this device. Quiet while sync is on and the
	server answers, since anything waiting then goes out within moments.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { App } from '#lib/app/app.svelte.ts';

	let { app, mobile = false }: { app: App; mobile?: boolean } = $props();

	const chip = $derived.by(() => {
		const n = app.waiting;
		switch (app.sync.kind) {
			case 'needs-login':
				return {
					href: resolve('/login'),
					text: n > 0 ? `sign in to sync · ${n} on this device only` : 'sign in to sync'
				};
			case 'offline':
				return {
					href: `${resolve('/settings')}#s-sync`,
					text: n > 0 ? `offline · ${n} waiting` : 'offline'
				};
			default:
				return null;
		}
	});
</script>

{#if chip}
	<a class="sync" class:mobile href={chip.href} data-kind={app.sync.kind}>
		<span class="lamp" aria-hidden="true"></span>{chip.text}
	</a>
{/if}

<style>
	.sync {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--ink-2);
		text-decoration: underline;
		text-decoration-color: var(--rule);
		text-underline-offset: 3px;
		white-space: nowrap;
	}
	.lamp {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ink-4);
	}
	.sync[data-kind='offline'] .lamp {
		background: transparent;
		box-shadow: inset 0 0 0 1.5px var(--ink-3);
	}
	.sync.mobile {
		display: flex;
		width: fit-content;
		margin: 0 0 6px;
	}
	@media (min-width: 1000px) {
		.sync.mobile {
			display: none;
		}
	}
</style>
