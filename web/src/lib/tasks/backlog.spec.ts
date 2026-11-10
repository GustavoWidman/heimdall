import { describe, expect, it } from 'vitest';
import type { Task } from '#lib/app/app.svelte.ts';
import { backlog } from './backlog';

const H = 3_600_000;
const now = 1_000 * H;
let n = 0;
function task(title: string, over: Record<string, unknown> = {}): Task {
	return {
		id: `t_${title}`,
		title,
		note: null,
		hue: 0,
		deadline: null,
		longRunning: false,
		status: 'active',
		createdAt: ++n,
		...over
	} as Task;
}

describe('the backlog', () => {
	const tasks = [
		task('plain'),
		task('due later', { deadline: now + 100 * H }),
		task('thread', { longRunning: true }),
		task('due soon', { deadline: now + 2 * H }),
		task('overdue', { deadline: now - H }),
		task('next month', { deadline: now + 30 * 24 * H }),
		task('finished', { status: 'done', deadline: now + H }),
		task('finished later', { status: 'done' }),
		task('shelved', { status: 'archived' })
	];
	const b = backlog(tasks, now);
	const titles = (ts: readonly Task[]) => ts.map((t) => t.title);

	it('puts long-term threads first, then the nearest deadline, then the rest', () => {
		expect(titles(b.active)).toEqual([
			'thread',
			'overdue',
			'due soon',
			'due later',
			'next month',
			'plain'
		]);
	});

	it('keeps done and archived apart, newest first', () => {
		expect(titles(b.done)).toEqual(['finished later', 'finished']);
		expect(titles(b.archived)).toEqual(['shelved']);
	});

	it('lists active deadlines in the coming week only', () => {
		expect(titles(b.soon)).toEqual(['due soon', 'due later']);
	});
});
