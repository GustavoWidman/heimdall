<script lang="ts">
	import YearScreen from '#lib/history/YearScreen.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<YearScreen asked={params.key} />
