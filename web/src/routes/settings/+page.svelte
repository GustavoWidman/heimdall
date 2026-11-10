<script lang="ts">
	import { resolve } from '$app/paths';
	import { syncLine } from '#lib/settings/sync-line.ts';
	import { applyTheme, storedTheme, THEMES, type Theme } from '#lib/ui/theme.ts';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	const { app } = useCtx();

	let theme = $state<Theme>(storedTheme());
	function pickTheme(t: Theme) {
		theme = t;
		applyTheme(t);
	}

	const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const zones = $derived.by(() => {
		const all = Intl.supportedValuesOf('timeZone');
		const current = app.settings.timeZone;
		return all.includes(current) ? all : [current, ...all];
	});
	const hours = Array.from({ length: 24 }, (_, h) => h);
	const bounces = $derived.by(() => {
		const all = [0, 1, 2, 3, 5, 10, 15];
		const current = app.settings.bounceMinutes as number;
		return all.includes(current) ? all : [...all, current].sort((a, b) => a - b);
	});

	const syncNow = $derived(Math.floor(app.now / 30_000) * 30_000);
	const signedIn = $derived(app.sync.kind !== 'needs-login');
	let signingOut = $state(false);
	async function signOut() {
		signingOut = true;
		try {
			await app.logout();
		} finally {
			signingOut = false;
		}
	}

	let exporting = $state(false);
	async function exportAll() {
		exporting = true;
		try {
			const data = await app.export();
			const url = URL.createObjectURL(
				new Blob([JSON.stringify(data, null, '\t')], { type: 'application/json' })
			);
			const a = document.createElement('a');
			a.href = url;
			a.download = `heimdall-${app.today.day}.json`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} finally {
			exporting = false;
		}
	}
</script>

<svelte:head><title>settings · heimdall</title></svelte:head>

<div class="settings">
	<h1>settings</h1>

	<section aria-labelledby="s-look">
		<h2 class="label" id="s-look">appearance</h2>
		<div class="row">
			<span class="what">
				<span id="theme-l">theme</span>
				<span class="hint">for this device only.</span>
			</span>
			<div class="seg" role="radiogroup" aria-labelledby="theme-l">
				{#each THEMES as t (t)}
					<button
						role="radio"
						aria-checked={theme === t}
						class:on={theme === t}
						onclick={() => pickTheme(t)}>{t}</button
					>
				{/each}
			</div>
		</div>
	</section>

	<section aria-labelledby="s-switching">
		<h2 class="label" id="s-switching">switching</h2>
		<label class="row">
			<span class="what">
				<span>quick taps juggle</span>
				<span class="hint">
					a task you leave again within this long joins a juggle with what you held, instead of
					replacing it. every day re-reads, past ones too.
				</span>
			</span>
			<select
				class="field pick mono"
				value={app.settings.bounceMinutes}
				onchange={(e) => app.do({ k: 'settings', bounceMinutes: Number(e.currentTarget.value) })}
			>
				{#each bounces as m (m)}
					<option value={m}>{m === 0 ? 'off' : `${m} min`}</option>
				{/each}
			</select>
		</label>
	</section>

	<section aria-labelledby="s-days">
		<h2 class="label" id="s-days">days</h2>
		<label class="row">
			<span class="what">
				<span>day starts at</span>
				<span class="hint">a switch before this hour counts toward the day before.</span>
			</span>
			<select
				class="field pick mono"
				value={app.settings.dayStartHour}
				onchange={(e) => app.do({ k: 'settings', dayStartHour: Number(e.currentTarget.value) })}
			>
				{#each hours as h (h)}
					<option value={h}>{String(h).padStart(2, '0')}:00</option>
				{/each}
			</select>
		</label>
		<div class="row wrap">
			<label class="what" for="zone">
				<span>time zone</span>
				<span class="hint">
					decides which day a late switch belongs to. it is shared by every device you sync.
				</span>
			</label>
			<div class="zone">
				<select
					id="zone"
					class="field pick"
					value={app.settings.timeZone}
					onchange={(e) => app.do({ k: 'settings', timeZone: e.currentTarget.value })}
				>
					{#each zones as z (z)}<option value={z}>{z.replaceAll('_', ' ')}</option>{/each}
				</select>
				{#if app.settings.timeZone !== deviceZone}
					<button
						class="chip small"
						onclick={() => app.do({ k: 'settings', timeZone: deviceZone })}
					>
						use this device’s, {deviceZone.replaceAll('_', ' ')}
					</button>
				{/if}
			</div>
		</div>
	</section>

	<section aria-labelledby="s-sync">
		<h2 class="label" id="s-sync">sync</h2>
		<div class="row">
			<span class="what">
				<span class="status">
					<span class="lamp" data-kind={app.sync.kind} aria-hidden="true"></span>
					{signedIn ? 'sync is on' : 'this device only'}
				</span>
				<span class="hint" aria-live="polite">{syncLine(app.sync, syncNow)}</span>
			</span>
			{#if signedIn}
				<button class="btn quiet" onclick={signOut} disabled={signingOut}>
					{signingOut ? 'signing out…' : 'sign out'}
				</button>
			{:else}
				<a class="btn quiet" href={resolve('/login')}>sign in</a>
			{/if}
		</div>
	</section>

	<section aria-labelledby="s-data">
		<h2 class="label" id="s-data">your data</h2>
		<div class="row">
			<span class="what">
				<span>export everything</span>
				<span class="hint">tasks, every switch, plans, and check-ins, as one json file.</span>
			</span>
			<button class="btn quiet" onclick={exportAll} disabled={exporting}>
				{exporting ? 'gathering…' : 'export'}
			</button>
		</div>
	</section>

	<section class="counts" aria-labelledby="s-counts">
		<h2 class="label" id="s-counts">how heimdall counts</h2>
		<dl>
			<dt>focus</dt>
			<dd>what you’re holding right now. one task, a few tasks, rest, or nothing at all.</dd>
			<dt>tap</dt>
			<dd>tap a task to make it your focus.</dd>
			<dt>hold</dt>
			<dd>
				hold a task to add it to what you’re already holding. holding two or more is a juggle.
			</dd>
			<dt>release</dt>
			<dd>hold a task inside a juggle to let go of it. letting go is never a switch.</dd>
			<dt>rest</dt>
			<dd>a pause. going from a to rest and back to a is no switch; from a to rest to b is one.</dd>
			<dt>tick</dt>
			<dd>
				still the notebook’s unit: one tap on a task. per-task ticks sit where you’re used to them.
			</dd>
			<dt>switch</dt>
			<dd>
				a moment something new enters your head. bouncing inside a juggle isn’t counted bounce by
				bounce. it shows up as juggle time instead, which is its own kind of strain.
			</dd>
		</dl>
		<table>
			<caption class="visually-hidden">which moves count as a switch</caption>
			<thead>
				<tr><th>you go from</th><th>to</th><th>is it a switch?</th></tr>
			</thead>
			<tbody>
				<tr><td>a</td><td>b</td><td>yes</td></tr>
				<tr><td>a</td><td>a and b</td><td>yes, b came in</td></tr>
				<tr><td>a and b</td><td>b</td><td>no, you only let go of a</td></tr>
				<tr><td>a</td><td>rest, then a</td><td>no, you came back</td></tr>
				<tr><td>a</td><td>rest, then b</td><td>yes, once</td></tr>
			</tbody>
		</table>
	</section>
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: 26px;
		padding-top: 6px;
	}
	h1 {
		font-size: 22px;
		font-weight: 560;
		letter-spacing: -0.02em;
	}
	h2 {
		font-weight: 400;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--rule);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 64px;
		padding: 12px 0;
		border-bottom: 1px solid var(--rule-2);
	}
	.row.wrap {
		flex-wrap: wrap;
	}
	.what {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
		min-width: 0;
		font-size: 15px;
	}
	.wrap .what {
		flex-basis: 100%;
	}
	.hint {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--ink-3);
	}
	.seg {
		display: flex;
		flex: none;
		padding: 3px;
		border: 1px solid var(--rule);
		border-radius: 13px;
	}
	.seg button {
		min-width: 58px;
		min-height: 38px;
		padding: 0 10px;
		border-radius: 10px;
		font-size: 13px;
		color: var(--ink-2);
		transition:
			background-color 0.2s,
			color 0.2s;
	}
	.seg button.on {
		background: var(--ink);
		color: var(--bg);
	}
	.pick {
		flex: none;
		width: auto;
		padding-right: 8px;
	}
	.zone {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		width: 100%;
	}
	.zone select {
		flex: 1;
		min-width: 0;
	}
	.chip.small {
		min-height: 40px;
		font-size: 12.5px;
		color: var(--ink-2);
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.lamp {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--ink-4);
	}
	.lamp[data-kind='idle'] {
		background: var(--ink);
	}
	.lamp[data-kind='syncing'] {
		background: var(--ink);
		animation: breathe 1.2s ease-in-out infinite;
	}
	.btn {
		flex: none;
		min-height: 44px;
		font-size: 14px;
		text-decoration: none;
	}
	.btn:disabled {
		opacity: 0.5;
	}
	dl {
		display: grid;
		grid-template-columns: 72px 1fr;
		gap: 10px 14px;
		padding: 14px 0 6px;
		font-size: 14px;
		line-height: 1.45;
	}
	dt {
		font-family: var(--mono);
		font-size: 12px;
		padding-top: 2px;
		color: var(--ink);
	}
	dd {
		color: var(--ink-2);
	}
	table {
		width: 100%;
		margin-top: 14px;
		border-collapse: collapse;
		font-size: 13px;
	}
	th {
		padding: 6px 8px 6px 0;
		border-bottom: 1px solid var(--rule);
		font-family: var(--mono);
		font-size: 11px;
		font-weight: 400;
		color: var(--ink-3);
		text-align: left;
	}
	td {
		padding: 9px 8px 9px 0;
		border-bottom: 1px solid var(--rule-2);
		color: var(--ink-2);
	}
	td:first-child,
	td:nth-child(2) {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--ink);
		white-space: nowrap;
	}

	@media (min-width: 1000px) {
		.settings {
			display: grid;
			grid-template-columns: 1fr 1fr;
			column-gap: 64px;
			max-width: 1100px;
			margin: 0 auto;
			padding-top: 16px;
		}
		h1 {
			grid-column: 1 / -1;
		}
		.counts {
			grid-column: 2;
			grid-row: 2 / span 4;
		}
	}
</style>
