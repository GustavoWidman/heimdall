import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { expect, open, shot, test } from './support/fixtures';
import { addDays, at, busyToday, history, TODAY } from './support/seed';

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const YESTERDAY = addDays(TODAY, -1);

const ROUTES = [
	'/',
	'/history',
	`/history/${YESTERDAY}`,
	'/week',
	'/month',
	'/year',
	'/insights',
	'/tasks',
	'/checkin',
	`/checkin/${YESTERDAY}`,
	'/settings',
	'/more',
	'/login'
];

type Violation = {
	id: string;
	impact: string;
	help: string;
	nodes: {
		target: string[];
		any: { data?: { fgColor?: string; bgColor?: string; contrastRatio?: number } }[];
	}[];
};

async function seriousViolations(page: Page): Promise<string[]> {
	await page.addScriptTag({ path: axePath });
	const found = await page.evaluate(async () => {
		const axe = (
			window as unknown as { axe: { run: (o: object) => Promise<{ violations: Violation[] }> } }
		).axe;
		const { violations } = await axe.run({ resultTypes: ['violations'] });
		return violations;
	});
	return found
		.filter((v) => v.impact === 'serious' || v.impact === 'critical')
		.map(
			(v) =>
				`${v.id} (${v.impact}): ${v.help} at ${v.nodes
					.map((n) => {
						const c = n.any[0]?.data;
						const colors = c?.contrastRatio
							? ` [${c.fgColor} on ${c.bgColor} = ${c.contrastRatio}]`
							: '';
						return n.target.join(' ') + colors;
					})
					.join(', ')}`
		);
}

async function horizontalOverflow(page: Page): Promise<number> {
	return page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
}

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`${scheme}`, () => {
		test.use({ colorScheme: scheme });

		test('every screen on an empty first day', async ({ page }, info) => {
			for (const route of ROUTES) {
				await open(page, route);
				await page.waitForTimeout(700);
				const name = route.replaceAll('/', '_') || '_';
				await shot(page, `${info.project.name}-empty-${scheme}${name}`);
				expect.soft(await horizontalOverflow(page), `no sideways scroll on ${route}`).toBe(0);
				expect.soft(await seriousViolations(page), `axe on ${route}`).toEqual([]);
			}
		});

		test.describe('with weeks of history', () => {
			test.use({ startAt: at(TODAY, '15:42') });

			test('every screen on a busy day', async ({ page, request }, info) => {
				await busyToday(history(70)).push(request);
				await open(page);
				await expect(page.getByRole('img', { name: '15' }).first()).toBeVisible();
				for (const route of ROUTES) {
					await open(page, route);
					await page.waitForTimeout(900);
					const name = route.replaceAll('/', '_') || '_';
					await shot(page, `${info.project.name}-full-${scheme}${name}`);
					if (route === '/' && info.project.name === 'desktop') {
						await shot(page, `${info.project.name}-full-${scheme}_today-page`, true);
					}
					expect.soft(await horizontalOverflow(page), `no sideways scroll on ${route}`).toBe(0);
					expect.soft(await seriousViolations(page), `axe on ${route}`).toEqual([]);
				}
			});
		});
	});
}
