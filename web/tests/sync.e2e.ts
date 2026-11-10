import { expect, open, test } from './support/fixtures';

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
