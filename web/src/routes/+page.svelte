<script module lang="ts">
	/** The day whose empty board already offered the open-the-day sheet once. */
	let offeredFor: string | null = null;
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { REASONS, type MarkId, type Task } from '#lib/app/app.svelte.ts';
	import Brand from '#lib/ui/Brand.svelte';
	import { dayLabel } from '#lib/ui/format.ts';
	import Odometer from '#lib/ui/Odometer.svelte';
	import RestButton from '#lib/ui/RestButton.svelte';
	import Ribbon from '#lib/ui/Ribbon.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { useCtx } from '#lib/ui/watch.svelte.ts';
	import EndDay from '#lib/today/EndDay.svelte';
	import EveningCheckIn from '#lib/today/EveningCheckIn.svelte';
	import FocusCard from '#lib/today/FocusCard.svelte';
	import ForgotSheet from '#lib/today/ForgotSheet.svelte';
	import Horizon from '#lib/today/Horizon.svelte';
	import MarkSheet from '#lib/today/MarkSheet.svelte';
	import PlanSheet from '#lib/today/PlanSheet.svelte';
	import RecentSwitches from '#lib/today/RecentSwitches.svelte';
	import TaskList from '#lib/today/TaskList.svelte';
	import TaskSheet from '#lib/today/TaskSheet.svelte';

	const { app, watch } = useCtx();
	const today = $derived(app.today);
	const rows = $derived(
		today.board.filter((r) => r.task.status !== 'archived' || r.day.ticks > 0 || r.inFocus)
	);
	const reasons = $derived(
		REASONS.map((r) => ({ r, n: today.view.transitions.filter((t) => t.reason === r).length }))
	);

	type Open =
		| { readonly k: 'plan'; readonly opening: boolean }
		| { readonly k: 'task'; readonly task: Task | null }
		| { readonly k: 'mark'; readonly mark: MarkId }
		| { readonly k: 'forgot' };
	const LABELS = {
		plan: 'plan the day',
		task: 'task',
		mark: 'fix a switch',
		forgot: 'forgot to tick'
	} as const;

	let sheet: Open = $state({ k: 'plan', opening: true });
	let open = $state(false);

	function show(s: Open) {
		sheet = s;
		open = true;
	}
	const close = () => (open = false);

	// Another device may already have planned the day. Offer once this one has heard from the
	// server or cannot reach it; a tab that does not run the sync stops waiting after a beat.
	const heard = $derived(
		app.sync.kind === 'offline' ||
			app.sync.kind === 'needs-login' ||
			(app.sync.kind === 'idle' && app.sync.lastOk !== null)
	);
	let waited = $state(false);
	onMount(() => {
		const id = setTimeout(() => (waited = true), 1500);
		return () => clearTimeout(id);
	});

	$effect(() => {
		if (today.board.length === 0 && offeredFor !== today.day && (heard || waited)) {
			offeredFor = today.day;
			show({ k: 'plan', opening: true });
		}
	});
	// Left with the sheet still up, as on a redirect to sign in: offer it again on return.
	onDestroy(() => {
		if (open && sheet.k === 'plan') offeredFor = null;
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || open) return;
		if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
		const digit = /^Digit([1-9])$/.exec(e.code);
		if (digit) {
			const row = rows[Number(digit[1]) - 1];
			if (!row) return;
			e.preventDefault();
			if (e.repeat) return;
			if (e.shiftKey) watch.press(row.task.id, 'hold');
			else watch.keyDown(e.code, row.task.id);
		} else if (e.key === 'n') {
			e.preventDefault();
			show({ k: 'plan', opening: false });
		}
	}

	onDestroy(() => watch.keyCancel());
</script>

<svelte:window {onkeydown} onkeyup={(e) => watch.keyUp(e.code)} onblur={() => watch.keyCancel()} />
<svelte:head><title>today · heimdall</title></svelte:head>

<div class="today">
	<header class="head">
		<span class="brand"><Brand /></span>
		<span class="date mono">{dayLabel(today.day)}</span>
		<span class="keys label" aria-hidden="true">
			<span><kbd>1</kbd>–<kbd>9</kbd> switch</span>
			<span>hold <kbd>1</kbd> juggle</span>
			<span><kbd>r</kbd> rest</span>
			<span><kbd>n</kbd> add</span>
		</span>
		<span class="count">
			<span class="big"><Odometer value={today.view.switches} /></span>
			<span class="label">{today.view.switches === 1 ? 'switch' : 'switches'}</span>
		</span>
	</header>

	<div class="rib">
		<Ribbon
			view={today.view}
			now={app.now}
			zone={app.settings.timeZone}
			hueOf={watch.hueOf}
			pulse={watch.moment}
		/>
	</div>

	<div class="instrument">
		<FocusCard onfix={(mark) => show({ k: 'mark', mark })} />
		<div class="desk"><Horizon /></div>
		<div class="desk rest"><RestButton hint /></div>
	</div>

	<div class="board">
		{#if rows.length === 0}
			<div class="empty">
				<p>the board is empty. nothing is being watched yet.</p>
				<button class="btn primary" onclick={() => show({ k: 'plan', opening: true })}>
					open the day
				</button>
			</div>
		{:else}
			<TaskList
				{rows}
				onedit={(task) => show({ k: 'task', task })}
				onadd={() => show({ k: 'plan', opening: false })}
			/>
			<EndDay />
		{/if}
	</div>

	<aside class="side">
		<EveningCheckIn />
		<section class="why desk" aria-label="why you switched today">
			<h2 class="label">why you switched today</h2>
			<div class="bars">
				{#each reasons as x (x.r)}
					<div><span class="v mono">{x.n}</span><span class="k">{x.r}</span></div>
				{/each}
			</div>
		</section>
		<RecentSwitches
			onopen={(m) => show({ k: 'mark', mark: m.id })}
			onforgot={() => show({ k: 'forgot' })}
		/>
	</aside>
</div>

<Sheet bind:open label={LABELS[sheet.k]}>
	{#if sheet.k === 'plan'}
		<PlanSheet opening={sheet.opening} ondone={close} />
	{:else if sheet.k === 'task'}
		{#key sheet.task?.id}
			<TaskSheet task={sheet.task} onclose={close} />
		{/key}
	{:else if sheet.k === 'mark'}
		{#key sheet.mark}
			<MarkSheet id={sheet.mark} onclose={close} />
		{/key}
	{:else}
		<ForgotSheet onclose={close} />
	{/if}
</Sheet>

<style>
	.today {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 44px;
	}
	.date {
		padding-left: 10px;
		border-left: 1px solid var(--rule);
		font-size: 12px;
		color: var(--ink-2);
	}
	.keys {
		display: none;
	}
	.count {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin-left: auto;
	}
	.big {
		font-size: 22px;
		font-weight: 500;
	}
	.desk {
		display: none;
	}
	.instrument {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 32px 16px;
		border: 1px dashed var(--rule);
		border-radius: 16px;
		text-align: center;
		color: var(--ink-2);
		font-size: 14px;
	}
	.side {
		margin-top: 12px;
	}
	.why h2 {
		font-weight: 400;
	}
	.why .bars {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
		margin-top: 8px;
	}
	.why .bars div {
		display: flex;
		flex-direction: column;
		padding-top: 7px;
		border-top: 1px solid var(--rule);
	}
	.why .v {
		font-size: 20px;
	}
	.why .k {
		font-size: 12px;
		color: var(--ink-2);
	}

	@media (min-width: 1000px) {
		.today {
			display: grid;
			grid-template-columns: minmax(300px, 360px) 1fr 320px;
			grid-template-areas: 'head head head' 'rib rib rib' 'instrument board side';
			column-gap: 28px;
			row-gap: 0;
			align-items: start;
		}
		.head {
			grid-area: head;
			height: auto;
			padding: 6px 0 12px;
			border-bottom: 1px solid var(--rule);
		}
		.brand {
			display: none;
		}
		.date {
			padding-left: 0;
			border-left: 0;
		}
		.keys {
			display: flex;
			gap: 14px;
			margin-left: 24px;
		}
		.keys span {
			display: inline-flex;
			align-items: center;
			gap: 5px;
		}
		.rib {
			grid-area: rib;
			padding: 20px 0 8px;
		}
		.instrument {
			grid-area: instrument;
			margin-top: 14px;
		}
		.desk {
			display: block;
		}
		.desk.rest {
			display: flex;
		}
		.desk.rest :global(button) {
			flex: 1;
		}
		.board {
			grid-area: board;
			margin-top: 14px;
		}
		.side {
			grid-area: side;
			display: flex;
			flex-direction: column;
			gap: 26px;
			margin-top: 14px;
		}
	}
</style>
