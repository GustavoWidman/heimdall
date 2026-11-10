<!--
	A modal sheet: slides up from the bottom on a phone, floats centered on a desktop.
	Built on <dialog>, so focus, Escape, and the inert background come from the browser.
	The content mounts on open, so a form inside starts fresh every time.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		label,
		children
	}: { open?: boolean; label: string; children: Snippet } = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let closing = $state(false);
	let mounted = $state(false);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			mounted = true;
			closing = false;
			dialog.showModal();
		} else if (!open && dialog.open && !closing) {
			closing = true;
			const done = () => {
				dialog?.close();
				closing = false;
				mounted = false;
			};
			if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
			else setTimeout(done, 220);
		}
	});

	function oncancel(e: Event) {
		e.preventDefault();
		open = false;
	}

	function onclick(e: MouseEvent) {
		if (e.target === dialog) open = false;
	}
</script>

<!-- Focus lands on the sheet itself: no keyboard popping up, no scroll to a field. -->
<!-- svelte-ignore a11y_autofocus -->
<dialog bind:this={dialog} aria-label={label} class:closing {oncancel} {onclick} autofocus>
	<div class="body">
		<span class="grab" aria-hidden="true"></span>
		{#if mounted}{@render children()}{/if}
	</div>
</dialog>

<style>
	dialog {
		width: 100%;
		max-width: 560px;
		max-height: 92dvh;
		margin: auto auto 0;
		padding: 0;
		border: 1px solid var(--rule);
		border-bottom: 0;
		border-radius: 24px 24px 0 0;
		background: var(--panel);
		color: var(--ink);
		overscroll-behavior: contain;
		outline: none;
	}
	dialog[open] {
		animation: rise 0.5s var(--spring);
	}
	dialog.closing {
		animation: sink 0.22s var(--snap) forwards;
	}
	dialog::backdrop {
		background: var(--scrim);
		animation: fade 0.3s;
	}
	dialog.closing::backdrop {
		animation: fade 0.22s reverse forwards;
	}
	.body {
		padding: 8px 20px calc(var(--safe-bottom) + 20px);
	}
	.grab {
		display: block;
		width: 36px;
		height: 4px;
		margin: 2px auto 14px;
		border-radius: 2px;
		background: var(--rule);
	}
	@keyframes rise {
		from {
			transform: translateY(100%);
		}
	}
	@keyframes sink {
		to {
			transform: translateY(100%);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	:global(html:has(dialog[open])) {
		overflow: hidden;
	}

	@media (min-width: 1000px) {
		dialog {
			max-width: 520px;
			max-height: 86vh;
			margin: auto;
			border-bottom: 1px solid var(--rule);
			border-radius: 24px;
			box-shadow: var(--shadow-float);
		}
		dialog[open] {
			animation: pop 0.45s var(--spring);
		}
		dialog.closing {
			animation: unpop 0.2s var(--snap) forwards;
		}
		.body {
			padding: 24px 24px 24px;
		}
		.grab {
			display: none;
		}
		@keyframes pop {
			from {
				opacity: 0;
				transform: translateY(12px) scale(0.97);
			}
		}
		@keyframes unpop {
			to {
				opacity: 0;
				transform: translateY(8px) scale(0.98);
			}
		}
	}
</style>
