<script lang="ts">
	let { d, size = 20 }: { d: string; size?: number } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path {d} /></svg>

<style>
	svg {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
