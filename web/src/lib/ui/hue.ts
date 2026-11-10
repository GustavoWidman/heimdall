import type { Task } from '#lib/app/app.svelte.ts';

/**
 * The hues a new task can get. Spread around the wheel and tuned against the --L and --C
 * tokens, so each stays distinct from its neighbours in both light and dark mode.
 */
export const PALETTE = [20, 48, 80, 130, 165, 195, 230, 262, 296, 334] as const;

function distance(a: number, b: number): number {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
}

/** The palette hue farthest from every active task's hue, so a new task stands apart. */
export function freeHue(tasks: readonly Task[]): number {
	const used = tasks.filter((t) => t.status === 'active').map((t) => t.hue as number);
	let best: number = PALETTE[0];
	let bestGap = -1;
	for (const h of PALETTE) {
		const gap = used.length ? Math.min(...used.map((u) => distance(h, u))) : 360;
		if (gap > bestGap) {
			best = h;
			bestGap = gap;
		}
	}
	return best;
}

/** A CSS color for a hue, for inline gradients that cannot use the .hue class. */
export function hueColor(h: number): string {
	return `oklch(var(--L) var(--C) ${h})`;
}
