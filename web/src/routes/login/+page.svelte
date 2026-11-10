<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Brand from '#lib/ui/Brand.svelte';
	import Iris from '#lib/ui/Iris.svelte';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	const { app } = useCtx();

	let password = $state('');
	let busy = $state(false);
	let problem: string | null = $state(null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!password || busy) return;
		busy = true;
		problem = null;
		try {
			if (await app.login(password)) {
				await goto(resolve('/'));
				return;
			}
			problem = 'that is not the password.';
		} catch {
			problem = 'the server is out of reach. heimdall keeps working offline meanwhile.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>sign in · heimdall</title></svelte:head>

<main class="login">
	<div class="eye"><Iris size={88} open={busy} hues={[230]} /></div>
	<Brand />
	<p class="sub">sign in to sync this device with your other ones.</p>

	<form onsubmit={submit}>
		<label class="label" for="password">password</label>
		<input
			id="password"
			class="field"
			type="password"
			autocomplete="current-password"
			bind:value={password}
			aria-describedby={problem ? 'problem' : undefined}
			aria-invalid={problem ? true : undefined}
		/>
		{#if problem}<p id="problem" class="problem" role="alert">{problem}</p>{/if}
		<button class="btn primary" disabled={!password || busy}>
			{busy ? 'signing in…' : 'sign in'}
		</button>
	</form>

	<a class="offline" href={resolve('/')}>keep using it offline</a>
</main>

<style>
	.login {
		display: flex;
		flex-direction: column;
		align-items: center;
		max-width: 360px;
		min-height: 100dvh;
		margin: 0 auto;
		padding: calc(var(--safe-top) + 14vh) 16px calc(var(--safe-bottom) + 24px);
		text-align: center;
	}
	.eye {
		margin-bottom: 20px;
	}
	.sub {
		margin-top: 8px;
		font-size: 14px;
		color: var(--ink-2);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
		margin-top: 32px;
		text-align: left;
	}
	.problem {
		font-size: 13px;
		color: var(--ink-2);
	}
	.btn {
		margin-top: 8px;
		transition:
			transform 0.25s var(--spring),
			opacity 0.2s;
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.offline {
		margin-top: auto;
		padding: 14px;
		font-size: 13px;
		color: var(--ink-3);
	}
</style>
