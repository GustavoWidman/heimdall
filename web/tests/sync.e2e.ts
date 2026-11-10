import { expect, open, planDay, row, setClock, tap, test } from './support/fixtures';
import { at, TODAY } from './support/seed';

test('an idle device stops talking to the server once it is in sync', async ({ page }) => {
	await open(page);
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.waitForTimeout(1000);
	let syncs = 0;
	page.on('request', (r) => {
		if (r.url().endsWith('/api/sync')) syncs++;
	});
	await page.waitForTimeout(3000);
	expect(syncs, 'sync requests in three idle seconds').toBeLessThanOrEqual(1);
});

test('a day planned on one device opens to its board on another', async ({ page, device }) => {
	await planDay(page, ['planned on the phone']);
	const other = await device();
	await open(other);
	await expect(row(other, 'planned on the phone')).toBeVisible();
	await other.waitForTimeout(800);
	await expect(other.getByRole('dialog'), 'no open-the-day sheet over a planned day').toBeHidden();
});

test('a tap on one device shows on the other within seconds', async ({ page, device, touch }) => {
	await planDay(page, ['shared work', 'other work']);
	const other = await device();
	await open(other);
	await expect(row(other, 'shared work')).toBeVisible();

	await setClock(page, at(TODAY, '09:00'));
	await tap(row(page, 'shared work'), touch);
	await expect(row(other, 'shared work')).toHaveAttribute('aria-pressed', 'true', {
		timeout: 4000
	});
	await setClock(other, at(TODAY, '09:05'));
	await tap(row(other, 'other work'), touch);
	await expect(row(page, 'other work')).toHaveAttribute('aria-pressed', 'true', {
		timeout: 4000
	});
	await expect(row(page, 'shared work')).toHaveAttribute('aria-pressed', 'false');
});

test.describe('without a network', () => {
	test.use({ networkErrorsOk: true });

	test('taps made offline reach the other device after reconnecting', async ({
		page,
		device,
		touch
	}) => {
		await planDay(page, ['on the train']);
		const other = await device();
		await open(other);
		await expect(row(other, 'on the train')).toBeVisible();

		await page.context().setOffline(true);
		await tap(row(page, 'on the train'), touch);
		await expect(row(page, 'on the train')).toHaveAttribute('aria-pressed', 'true');
		await page.waitForTimeout(1500);
		await expect(row(other, 'on the train')).toHaveAttribute('aria-pressed', 'false');

		await page.context().setOffline(false);
		await expect(row(other, 'on the train')).toHaveAttribute('aria-pressed', 'true', {
			timeout: 6000
		});
	});

	test('the app opens offline from the service worker', async ({ page, touch }) => {
		await planDay(page, ['offline first']);
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
		});
		await page.reload();
		await expect(row(page, 'offline first')).toBeVisible();

		await page.context().setOffline(true);
		await page.reload();
		await expect(row(page, 'offline first')).toBeVisible();
		await tap(row(page, 'offline first'), touch);
		await expect(row(page, 'offline first')).toHaveAttribute('aria-pressed', 'true');
		await page
			.getByRole('link', { name: /^history/ })
			.first()
			.click();
		await expect(page).toHaveURL(/\/history/);
	});
});
