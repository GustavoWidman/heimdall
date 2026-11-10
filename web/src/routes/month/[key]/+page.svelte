<script lang="ts">
	import MonthScreen from '#lib/history/MonthScreen.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<MonthScreen asked={params.key} />
