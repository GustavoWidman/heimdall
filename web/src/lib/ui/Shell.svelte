<!--
	The frame around every screen: the desktop bar, the mobile tab bar with the rest button
	under the thumb, the after-switch toasts, global shortcuts, and the sign-in routing.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { App } from '#lib/app/app.svelte.ts';
	import Brand from './Brand.svelte';
	import Icon from './Icon.svelte';
	import { DESTINATIONS, MORE_ICON, type Destination } from './nav';
	import RestButton from './RestButton.svelte';
	import SyncChip from './SyncChip.svelte';
	import Toasts from './Toasts.svelte';
	import { provideCtx, Watch } from './watch.svelte';

	let { app, children }: { app: App; children: Snippet } = $props();

	// The app is opened once by the layout and never replaced.
	// svelte-ignore state_referenced_locally
	const watch = new Watch(app);
	// svelte-ignore state_referenced_locally
	provideCtx({ app, watch });

	const path = $derived(page.url.pathname);
	const bare = $derived(path === resolve('/login'));
	const needsLogin = $derived(app.sync.kind === 'needs-login');

	const href = (d: Destination) => resolve(d.path);
	/** A screen with a key in its path, such as one day of history, is still that screen. */
	const isHere = (d: Destination) =>
		path === href(d) || (d.path !== '/' && path.startsWith(`${href(d)}/`));
	const tabs = DESTINATIONS.filter((d) => d.tab);
	const moreHere = $derived(
		path === resolve('/more') || DESTINATIONS.some((d) => !d.tab && isHere(d))
	);

	let sentToLogin = false;
	$effect(() => {
		if (needsLogin && app.tasks.length === 0 && !bare && !sentToLogin) {
			sentToLogin = true;
			void goto(resolve('/login'));
		}
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || bare) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		if (document.querySelector('dialog[open]')) return;
		if (e.key === 'r' && !e.shiftKey) {
			e.preventDefault();
			watch.act({ k: 'rest' });
			return;
		}
		const d = DESTINATIONS.find((x) => x.key === e.key);
		if (d && !isHere(d)) {
			e.preventDefault();
			void goto(href(d));
		}
	}
</script>

<svelte:window {onkeydown} />

{#if bare}
	{@render children()}
{:else}
	<header class="bar">
		<a class="home" href={resolve('/')} aria-label="heimdall, today"><Brand /></a>
		<nav aria-label="screens">
			{#each DESTINATIONS as d (d.path)}
				<a href={href(d)} aria-current={isHere(d) ? 'page' : undefined}>
					{d.label}<kbd>{d.key}</kbd>
				</a>
			{/each}
		</nav>
		<SyncChip {app} />
	</header>

	<main>
		<SyncChip {app} mobile />
		{@render children()}
	</main>

	<Toasts />

	<nav class="tabbar" aria-label="screens">
		<div class="in">
			{#each tabs.slice(0, 2) as d (d.path)}
				<a class="tab" href={href(d)} aria-current={isHere(d) ? 'page' : undefined}>
					<Icon d={d.icon} />{d.label}
				</a>
			{/each}
			<RestButton />
			{#each tabs.slice(2) as d (d.path)}
				<a class="tab" href={href(d)} aria-current={isHere(d) ? 'page' : undefined}>
					<Icon d={d.icon} />{d.label}
				</a>
			{/each}
			<a class="tab" href={resolve('/more')} aria-current={moreHere ? 'page' : undefined}>
				<Icon d={MORE_ICON} />more
			</a>
		</div>
	</nav>
{/if}

<style>
	main {
		max-width: 560px;
		margin: 0 auto;
		padding: calc(var(--safe-top) + 10px) var(--gutter)
			calc(var(--tab-h) + var(--safe-bottom) + 28px);
	}
	.bar {
		display: none;
	}
	.tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 15;
		padding: 0 var(--gutter) var(--safe-bottom);
		background: var(--bg);
	}
	.tabbar::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 100%;
		height: 24px;
		background: linear-gradient(to top, var(--bg), transparent);
		pointer-events: none;
	}
	.tabbar .in {
		display: grid;
		grid-template-columns: 1fr 1fr auto 1fr 1fr;
		align-items: center;
		max-width: 560px;
		height: var(--tab-h);
		margin: 0 auto;
		border-top: 1px solid var(--rule);
	}
	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		min-height: 48px;
		font-size: 11px;
		color: var(--ink-3);
		text-decoration: none;
		transition: color 0.2s;
	}
	.tab[aria-current='page'] {
		color: var(--ink);
	}

	@media (min-width: 1000px) {
		main {
			max-width: 1440px;
			padding: 0 var(--gutter) 32px;
		}
		.tabbar {
			display: none;
		}
		.bar {
			display: flex;
			align-items: center;
			gap: 28px;
			max-width: 1440px;
			height: 56px;
			margin: 0 auto;
			padding: 0 var(--gutter);
		}
		.home {
			text-decoration: none;
		}
		.bar nav {
			display: flex;
			gap: 4px;
		}
		.bar nav a {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			height: 32px;
			padding: 0 8px;
			border-radius: 8px;
			font-size: 13px;
			color: var(--ink-3);
			text-decoration: none;
			transition:
				color 0.2s,
				background-color 0.2s;
		}
		.bar nav a:hover {
			color: var(--ink);
		}
		.bar nav a[aria-current='page'] {
			color: var(--ink);
			background: var(--panel-2);
		}
		.bar kbd {
			font-size: 9.5px;
			line-height: 14px;
			padding: 0 4px;
			color: var(--ink-3);
		}
		.bar :global(.sync) {
			margin-left: auto;
		}
	}
</style>
