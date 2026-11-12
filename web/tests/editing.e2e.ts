import type { Page } from '@playwright/test';
import { expect, open, planDay, row, setClock, tap, test } from './support/fixtures';
import { addDays, at, Seed, TODAY } from './support/seed';

const switches = (page: Page) => page.getByRole('main').locator('header').getByRole('img').first();
const focus = (page: Page) => page.getByRole('region', { name: 'now' });
const recent = (page: Page, hhmm: string) =>
	page.getByRole('main').getByRole('button', { name: new RegExp(`^${hhmm}\\b`) });

async function morning(page: Page, touch: boolean) {
	await planDay(page, ['alpha', 'beta']);
	for (const [hhmm, title] of [
		['09:00', 'alpha'],
		['09:30', 'beta'],
		['10:00', 'alpha']
	] as const) {
		await setClock(page, at(TODAY, hhmm));
		await tap(row(page, title), touch);
	}
	await setClock(page, at(TODAY, '10:05'));
	await expect(switches(page)).toHaveAccessibleName('2');
}

test('voiding a switch and restoring it re-derives the day', async ({ page, touch }) => {
	await morning(page, touch);
	await recent(page, '09:30').click();
	const sheet = page.getByRole('dialog');
	await sheet.getByRole('button', { name: 'void it' }).click();
	await expect(sheet.getByText('voided. it no longer counts.')).toBeVisible();
	await expect(switches(page), 'the tap back to alpha is now a repeat').toHaveAccessibleName('0');
	await expect(row(page, 'beta')).toHaveAccessibleName(/ 0 ticks /);
	await sheet.getByRole('button', { name: 'restore it' }).click();
	await expect(switches(page)).toHaveAccessibleName('2');
	await sheet.getByRole('button', { name: 'done' }).last().click();
	await expect(sheet).toBeHidden();
});

test('moving a switch earlier re-orders the day', async ({ page, touch }) => {
	await morning(page, touch);
	await recent(page, '10:00').click();
	const sheet = page.getByRole('dialog');
	await sheet.getByLabel('when').fill('09:20');
	await sheet.getByRole('button', { name: 'move' }).click();
	await sheet.getByRole('button', { name: 'done' }).last().click();
	await expect(switches(page)).toHaveAccessibleName('1');
	await expect(focus(page), 'beta, at 09:30, is now the latest').toContainText('beta');
	await expect(recent(page, '09:20')).toBeVisible();
});

test('a forgotten tick slots into the day and counts', async ({ page, touch }) => {
	await morning(page, touch);
	await page.getByRole('button', { name: 'forgot to tick?' }).click();
	const sheet = page.getByRole('dialog');
	await sheet.getByText('beta', { exact: true }).click();
	await sheet.getByLabel('at', { exact: true }).fill('09:45');
	await sheet.getByRole('button', { name: 'log it' }).click();
	await expect(sheet).toBeHidden();
	await expect(switches(page), 'beta at 09:30 then 09:45 is a repeat').toHaveAccessibleName('2');
	await expect(recent(page, '09:45')).toBeVisible();

	await page.getByRole('button', { name: 'forgot to tick?' }).click();
	await sheet.getByText('rest', { exact: true }).click();
	await sheet.getByLabel('at', { exact: true }).fill('09:50');
	await sheet.getByRole('button', { name: 'log it' }).click();
	await expect(
		switches(page),
		'rest at 09:50, then alpha at 10:00 is a switch'
	).toHaveAccessibleName('2');
	await expect(row(page, 'alpha')).toHaveAccessibleName(/ 2 ticks /);
});

test.describe('across the day start', () => {
	test.use({ startAt: at(TODAY, '23:40') });

	test('focus carries past 04:00 into the new day', async ({ page, touch }) => {
		await planDay(page, ['late night']);
		await setClock(page, at(TODAY, '23:50'));
		await tap(row(page, 'late night'), touch);
		await page.clock.fastForward('04:25:00');
		await expect(page.getByRole('main').getByText('wed 11 nov')).toBeVisible();
		await expect(focus(page)).toContainText('late night');
		await expect(focus(page)).toContainText('since 23:50');
		await expect(focus(page).getByRole('timer'), 'the timer keeps running from 23:50').toHaveText(
			/^4:\d\d:\d\d$/
		);
		await expect(switches(page)).toHaveAccessibleName('0');
		await expect(row(page, 'late night')).toHaveAttribute('aria-pressed', 'true');
		await open(page, `/history/${TODAY}`);
		await expect(page.getByRole('region', { name: 'switch ledger' }).last()).toContainText('23:50');
	});
});

test.describe('the day start hour', () => {
	test.use({ startAt: at(addDays(TODAY, 1), '12:00') });

	test('moving it re-buckets a late switch', async ({ page, request }) => {
		const tomorrow = addDays(TODAY, 1);
		await new Seed()
			.task('seed_a', 'evening work', 200)
			.task('seed_b', 'night owl', 30)
			.mark(at(TODAY, '20:00'), { k: 'tap', task: 'seed_a' })
			.mark(at(tomorrow, '02:30'), { k: 'tap', task: 'seed_b' })
			.push(request);
		const ledger = page.getByRole('region', { name: 'switch ledger' }).last();
		await open(page, `/history/${TODAY}`);
		await expect(ledger).toContainText('02:30');

		await open(page, '/settings');
		await page.getByLabel(/day starts at/).selectOption('2');
		await open(page, `/history/${TODAY}`);
		await expect(ledger).toContainText('20:00');
		await expect(ledger).not.toContainText('02:30');
		await open(page, `/history/${tomorrow}`);
		await expect(ledger).toContainText('02:30');
	});
});

test.describe('a day left running overnight', () => {
	test.use({ startAt: at(addDays(TODAY, 1), '08:30') });

	test('ending it late turns the night back into a gap', async ({ page, request }) => {
		await new Seed()
			.task('seed_a', 'evening work', 200)
			.mark(at(TODAY, '21:00'), { k: 'tap', task: 'seed_a' })
			.mark(at(TODAY, '23:30'), { k: 'rest' })
			.push(request);
		await open(page);
		const sheet = page.getByRole('dialog');
		if (await sheet.isVisible()) await sheet.getByRole('button', { name: 'done' }).click();
		await expect(sheet).toBeHidden();
		await expect(page.getByRole('main'), 'the night counts as rest').toContainText('rest 4h30');

		await page.getByRole('button', { name: 'forgot to tick?' }).click();
		await sheet.getByText('ended the day', { exact: true }).click();
		await expect(sheet.getByText('alongside what I held')).toBeHidden();
		await sheet.getByLabel('at', { exact: true }).fill('23:45');
		await sheet.getByRole('button', { name: 'log it' }).click();
		await expect(sheet).toBeHidden();
		await expect(page.getByRole('main')).toContainText('rest 0m');

		await open(page, `/history/${TODAY}`);
		await expect(page.getByRole('region', { name: 'switch ledger' }).last()).toContainText('23:45');
	});
});
