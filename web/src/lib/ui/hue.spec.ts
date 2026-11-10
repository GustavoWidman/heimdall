import { describe, expect, it } from 'vitest';
import type { Task } from '#lib/app/app.svelte.ts';
import { freeHue, PALETTE } from './hue';

let n = 0;
function task(hue: number, status: Task['status'] = 'active'): Task {
	n++;
	return {
		id: `t${n}`,
		title: `task ${n}`,
		note: null,
		hue,
		deadline: null,
		longRunning: false,
		status,
		createdAt: n
	} as unknown as Task;
}

describe('freeHue', () => {
	it('gives every palette hue once before any hue twice', () => {
		const tasks: Task[] = [];
		for (let i = 0; i < PALETTE.length; i++) tasks.push(task(freeHue(tasks)));
		expect(new Set(tasks.map((t) => t.hue)).size).toBe(PALETTE.length);
	});

	it('picks a least-used hue once the palette is full', () => {
		const tasks: Task[] = PALETTE.map((h) => task(h));
		tasks.push(task(PALETTE[0]), task(PALETTE[1]));
		const next = freeHue(tasks);
		expect(PALETTE).toContain(next);
		expect(tasks.filter((t) => t.hue === next)).toHaveLength(1);
	});

	it('spreads a long list evenly over the palette', () => {
		const tasks: Task[] = [];
		for (let i = 0; i < PALETTE.length * 3; i++) tasks.push(task(freeHue(tasks)));
		const uses = PALETTE.map((h) => tasks.filter((t) => t.hue === h).length);
		expect(uses).toEqual(PALETTE.map(() => 3));
	});

	it('counts only active tasks', () => {
		const tasks = PALETTE.slice(1).map((h) => task(h));
		tasks.push(task(PALETTE[0], 'done'), task(PALETTE[0], 'archived'));
		expect(freeHue(tasks)).toBe(PALETTE[0]);
	});

	it('keeps clear of hues that are off the palette', () => {
		const next = freeHue([task(25), task(50)]);
		expect(Math.min(Math.abs(next - 25), Math.abs(next - 50))).toBeGreaterThan(60);
	});
});
