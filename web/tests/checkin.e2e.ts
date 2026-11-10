import type { Page } from '@playwright/test';
import { expect, open, test } from './support/fixtures';
import { addDays, TODAY } from './support/seed';

const YESTERDAY = addDays(TODAY, -1);
const question = (page: Page, text: RegExp) => page.getByRole('group', { name: text });
const questions = (page: Page) =>
	page
		.getByRole('main')
		.getByRole('group')
		.evaluateAll((gs) =>
			gs.map(
				(g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent ?? ''
			)
		);

async function openMore(page: Page) {
	const fold = page.getByRole('button', { name: /^more \d+ optional/ });
	if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click();
	await expect(fold).toHaveAttribute('aria-expanded', 'true');
}

test('an answer is kept, can be cleared, and survives a reload', async ({ page }) => {
	await open(page, '/checkin');
	await expect(page.getByRole('heading', { name: 'how today felt' })).toBeVisible();
	const stress = question(page, /stressed/i);
	await stress.getByRole('button', { name: 'quite' }).click();
	await expect(stress.getByRole('button', { name: 'quite' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const strain = question(page, /worn out/i);
	await strain.getByRole('button', { name: 'a little' }).click();
	await page.waitForTimeout(50);

	await page.reload();
	await expect(stress.getByRole('button', { name: 'quite' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: /^clear .*worn out/i }).click();
	await page.waitForTimeout(50);
	await expect(strain.getByRole('button', { name: 'a little' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await page.reload();
	await expect(strain.getByRole('button', { name: 'a little' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await expect(stress.getByRole('button', { name: 'quite' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('a past day takes answers of its own', async ({ page }) => {
	await open(page, `/checkin/${YESTERDAY}`);
	await expect(page.getByRole('heading', { name: 'how the day felt' })).toBeVisible();
	await question(page, /mood/i).getByRole('button', { name: 'good', exact: true }).click();
	await expect(
		question(page, /mood/i).getByRole('button', { name: 'good', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	await page.waitForTimeout(50);
	await open(page, '/checkin');
	await expect(
		question(page, /mood/i).getByRole('button', { name: 'good', exact: true })
	).toHaveAttribute('aria-pressed', 'false');
	await open(page, `/checkin/${YESTERDAY}`);
	await expect(
		question(page, /mood/i).getByRole('button', { name: 'good', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
});

test('questions speak lowercase, and of the day being answered', async ({ page }) => {
	await open(page, '/checkin');
	await openMore(page);
	const today = await questions(page);
	expect(today.length).toBeGreaterThan(10);
	expect(today.filter((q) => q[0] !== q[0].toLowerCase())).toEqual([]);

	await open(page, `/checkin/${YESTERDAY}`);
	await openMore(page);
	const past = await questions(page);
	expect(past.length).toBe(today.length);
	expect(past.filter((q) => /\b(today|right now|this evening|last night)\b/i.test(q))).toEqual([]);
});

test('the summary line says a note was written without repeating the word', async ({ page }) => {
	await open(page, '/checkin');
	await openMore(page);
	await page.getByRole('textbox', { name: /anything else worth remembering/i }).fill('long day');
	await expect(page.getByText(/note written/)).toBeVisible();
	await expect(page.getByRole('main')).not.toContainText('note a note');
});
