<script lang="ts">
	import '#lib/ui/fonts.css';
	import '#lib/ui/app.css';
	import geist from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
	import geistMono from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url';
	import favicon from '#lib/assets/favicon.svg';
	import { openApp } from '#lib/app/app.svelte.ts';
	import Shell from '#lib/ui/Shell.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const opening = openApp();
	void opening.then(askToPersist);

	/** Asks once, on the first run, that the browser never evict the local data. */
	async function askToPersist() {
		const KEY = 'heimdall.persist-asked';
		try {
			if (!navigator.storage?.persist || localStorage.getItem(KEY)) return;
			localStorage.setItem(KEY, '1');
			if (!(await navigator.storage.persisted())) await navigator.storage.persist();
		} catch {
			// Storage the browser refuses to promise is still storage; the app works the same.
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preload" href={geist} as="font" type="font/woff2" crossorigin="anonymous" />
	<link rel="preload" href={geistMono} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

{#await opening then app}
	<Shell {app}>{@render children()}</Shell>
{:catch error}
	<p class="broken">
		heimdall could not open its storage on this device. {error instanceof Error
			? error.message
			: ''}
	</p>
{/await}

<style>
	.broken {
		max-width: 420px;
		margin: 30vh auto 0;
		padding: 0 16px;
		color: var(--ink-2);
	}
</style>
