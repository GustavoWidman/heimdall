<script lang="ts">
	import HistoryScreen from '#lib/history/HistoryScreen.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<HistoryScreen asked={params.day} />
