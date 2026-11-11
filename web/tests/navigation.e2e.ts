import type { Page } from '@playwright/test';
import { expect, open, test } from './support/fixtures';
import { addDays, at, busyToday, history, TODAY } from './support/seed';

test.use({ startAt: at(TODAY, '15:42') });

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

/** A finger dragged across the day pager, as WebKit would report it. */
async function swipe(page: Page, from: number, to: number) {
	const pager = page.getByRole('group', { name: 'days, swipe left or right for others' });
	const y = 400;
	const steps = 8;
	const init = { pointerType: 'touch', pointerId: 7, isPrimary: true, bubbles: true };
	await pager.dispatchEvent('pointerdown', { ...init, clientX: from, clientY: y });
	for (let i = 1; i <= steps; i++) {
		const x = from + ((to - from) * i) / steps;
		await pager.dispatchEvent('pointermove', { ...init, clientX: x, clientY: y });
		await page.waitForTimeout(16);
	}
	await pager.dispatchEvent('pointerup', { ...init, clientX: to, clientY: y });
}

test('history steps a day at a time: a swipe on the phone, arrow keys on desktop', async ({
	page,
	request,
	touch
}) => {
	await busyToday(history(10)).push(request);
	await open(page, '/history');
	await expect(heading(page), 'history opens on yesterday').toHaveText('mon 9 nov');
	if (touch) {
		await swipe(page, 60, 340);
		await expect(page).toHaveURL(new RegExp(`/history/${addDays(TODAY, -2)}$`));
		await expect(heading(page)).toHaveText('sun 8 nov');
		await swipe(page, 340, 60);
		await expect(heading(page)).toHaveText('mon 9 nov');
		await swipe(page, 340, 60);
		await expect(heading(page)).toHaveText(/^tue 10 nov/);
	} else {
		await page.keyboard.press('ArrowLeft');
		await expect(page).toHaveURL(new RegExp(`/history/${addDays(TODAY, -2)}$`));
		await expect(heading(page)).toHaveText('sun 8 nov');
		await page.keyboard.press('ArrowRight');
		await expect(heading(page)).toHaveText('mon 9 nov');
		await page.keyboard.press('ArrowRight');
		await expect(heading(page)).toHaveText(/^tue 10 nov/);
	}
});

test('week, month, and year step back and open their days', async ({ page, request }) => {
	await busyToday(history(60)).push(request);

	await open(page, '/week');
	await expect(heading(page)).toHaveText('9 – 15 nov');
	await page
		.getByRole('button', { name: 'previous week' })
		.or(page.getByRole('link', { name: 'previous week' }))
		.click();
	await expect(heading(page)).toHaveText('2 – 8 nov');
	await page.getByRole('link', { name: /^wed 4: \d+ switches, open the day/ }).click();
	await expect(page).toHaveURL(/\/history\/2026-11-04$/);
	await expect(heading(page)).toHaveText('wed 4 nov');

	await open(page, '/month');
	await expect(heading(page)).toHaveText('november 2026');
	await page
		.getByRole('button', { name: 'previous month' })
		.or(page.getByRole('link', { name: 'previous month' }))
		.click();
	await expect(heading(page)).toHaveText('october 2026');
	await page.getByRole('link', { name: /^thu 15 oct/ }).click();
	await expect(page).toHaveURL(/\/history\/2026-10-15$/);

	await open(page, '/year');
	await expect(heading(page)).toHaveText('2026');
	await page
		.getByRole('button', { name: 'previous year' })
		.or(page.getByRole('link', { name: 'previous year' }))
		.click();
	await expect(heading(page)).toHaveText('2025');
	await page
		.getByRole('button', { name: 'next year' })
		.or(page.getByRole('link', { name: 'next year' }))
		.click();
	await expect(heading(page)).toHaveText('2026');
	const months = page.getByRole('region', { name: 'switches by month' });
	await expect(months.getByRole('link', { name: 'dec: still ahead' })).toBeVisible();
	await page.getByRole('button', { name: 'load', exact: true }).click();
	await expect(page.getByText(/^[\dh]+ load over \d+ days\./)).toBeVisible();
	await page.getByRole('button', { name: 'switches', exact: true }).click();
	await months.getByRole('link', { name: /^oct: \d+ switches$/ }).click();
	await expect(page).toHaveURL(/\/month\/2026-10$/);
	await expect(heading(page)).toHaveText('october 2026');
});

test('a letter key opens each screen on desktop', async ({ page, touch }) => {
	test.skip(touch, 'a keyboard is a desktop thing');
	await open(page);
	await page.getByRole('dialog').getByRole('button', { name: 'done' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	const keys: [string, RegExp][] = [
		['h', /\/history(\/[\d-]+)?$/],
		['w', /\/week(\/[\d-]+)?$/],
		['m', /\/month(\/[\d-]+)?$/],
		['y', /\/year(\/[\d-]+)?$/],
		['i', /\/insights(\/[\d-]+)?$/],
		['l', /\/tasks(\/[\d-]+)?$/],
		['e', /\/checkin(\/[\d-]+)?$/],
		[',', /\/settings(\/[\d-]+)?$/],
		['t', /\/$/]
	];
	for (const [key, url] of keys) {
		await page.keyboard.press(key);
		await expect(page, `the ${key} key`).toHaveURL(url);
		await expect(
			page.getByRole('navigation', { name: 'screens' }).first().locator('[aria-current="page"]')
		).toHaveCount(1);
	}
});
