import { readFileSync } from 'node:fs';
import { expect, open, planDay, row, tap, test } from './support/fixtures';
import { PASSWORD } from './support/server';

test('a chosen theme is on the page before its first paint', async ({ page }) => {
	await page.addInitScript(() => {
		new MutationObserver((_, observer) => {
			if (!document.body) return;
			observer.disconnect();
			(window as unknown as { firstPaintTheme: string | undefined }).firstPaintTheme =
				document.documentElement.dataset.theme;
		}).observe(document, { childList: true, subtree: true });
	});
	await open(page, '/settings');
	const theme = page.getByRole('radiogroup', { name: 'theme' });
	await theme.getByRole('radio', { name: 'dark' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(12, 12, 13)');

	await page.reload();
	expect(
		await page.evaluate(() => (window as unknown as { firstPaintTheme: string }).firstPaintTheme)
	).toBe('dark');
	await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
		'content',
		'#0c0c0d'
	);
	await expect(theme.getByRole('radio', { name: 'dark' })).toHaveAttribute('aria-checked', 'true');

	await theme.getByRole('radio', { name: 'light' }).click();
	await page.reload();
	expect(
		await page.evaluate(() => (window as unknown as { firstPaintTheme: string }).firstPaintTheme)
	).toBe('light');
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 242, 238)');
});

test('export holds the tasks and every switch', async ({ page, touch }) => {
	await planDay(page, ['exported task', 'another']);
	await tap(row(page, 'exported task'), touch);
	await tap(row(page, 'another'), touch);
	await page.waitForTimeout(50);
	await open(page, '/settings');
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'export' }).click()
	]);
	expect(download.suggestedFilename()).toBe('heimdall-2026-11-10.json');
	const data = JSON.parse(readFileSync((await download.path())!, 'utf8'));
	expect(data.format).toBe('heimdall-export');
	expect(data.tasks.map((t: { title: string }) => t.title).sort()).toEqual([
		'another',
		'exported task'
	]);
	expect(data.marks).toHaveLength(2);
	expect(data.plans).toHaveLength(2);
});

test.describe('signed out', () => {
	test.use({ networkErrorsOk: true });

	test('signing out keeps the device working, and signing in brings sync back', async ({
		page,
		touch
	}) => {
		await planDay(page, ['kept here']);
		await open(page, '/settings');
		await expect(page.getByText('sync is on')).toBeVisible();
		await page.getByRole('button', { name: 'sign out' }).click();
		await expect(page.getByText('this device only').first()).toBeVisible();

		await open(page);
		await expect(row(page, 'kept here')).toBeVisible();
		await tap(row(page, 'kept here'), touch);
		await expect(row(page, 'kept here')).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('link', { name: 'sign in to sync' }).first().click();

		await page.getByLabel('password').fill(PASSWORD);
		await page.getByRole('button', { name: 'sign in' }).click();
		await expect(page).toHaveURL(/\/$/);
		await expect(row(page, 'kept here')).toHaveAttribute('aria-pressed', 'true');
		await open(page, '/settings');
		await expect(page.getByText('sync is on')).toBeVisible();
	});

	test('the right password right after wrong ones is not called wrong', async ({ page }) => {
		await open(page, '/login');
		const password = page.getByLabel('password');
		const submit = page.getByRole('button', { name: 'sign in' });
		for (const guess of ['not it', 'nor this']) {
			await password.fill(guess);
			await submit.click();
			await expect(page.getByRole('alert')).toHaveText('that is not the password.');
			await page.waitForTimeout(1100);
		}
		await password.fill(PASSWORD);
		await submit.click();
		await expect(page.getByRole('alert')).toHaveText(
			/^too many tries in a row\. try again in \d+ s\.$/
		);
		await page.waitForTimeout(2500);
		await submit.click();
		await expect(page).toHaveURL(/\/$/);
	});
});

test.describe('a device that never signed in', () => {
	test.use({ signedIn: false, networkErrorsOk: true });

	test('is sent to sign in, and can keep using it offline', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);
		await page.getByRole('link', { name: 'keep using it offline' }).click();
		await expect(
			page.getByRole('dialog').getByRole('heading', { name: 'open the day' })
		).toBeVisible();
	});
});
