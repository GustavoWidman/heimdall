<script lang="ts">
	import CheckInPage from '#lib/checkin/CheckInPage.svelte';
	import { useCtx } from '#lib/ui/watch.svelte.ts';

	const { app } = useCtx();
</script>

{#key app.today.day}<CheckInPage day={app.today.day} />{/key}
