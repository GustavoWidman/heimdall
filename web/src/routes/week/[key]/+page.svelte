<script lang="ts">
	import WeekScreen from '#lib/history/WeekScreen.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<WeekScreen asked={params.key} />
