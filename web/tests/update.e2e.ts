import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, open, planDay, shot, test } from './support/fixtures';
import type { Server } from './support/server';

test.use({ ownBuild: true });

/** Puts a different service worker in place, as the next release would. */
function deploy(server: Server) {
	const sw = join(server.webDir, 'service-worker.js');
	appendFileSync(sw, '\n// the next build\n');
	for (const ext of ['.br', '.gz', '.etag', '.br.etag', '.gz.etag'])
		rmSync(sw + ext, { force: true });
}

/** Opens a planned day under a service worker, with no newer build yet. */
async function settle(page: Page) {
	await planDay(page, ['the next build']);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	await expect(page.locator('main')).toBeVisible();
	await expect(page.getByRole('region', { name: 'new version' })).toBeHidden();
}

async function check(page: Page) {
	await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.update()));
}

test('a newer build rises from the bottom and takes over on tap', async ({ page, server }) => {
	await settle(page);
	deploy(server);
	await check(page);
	const popup = page.getByRole('region', { name: 'new version' });
	await expect(popup).toBeVisible();
	await shot(page, 'update-ready');

	const reloaded = page.waitForEvent('load');
	await popup.getByRole('button', { name: 'reload' }).click();
	await reloaded;
	await expect(page.locator('main')).toBeVisible();
	await expect(popup).toBeHidden();
	await open(page, '/more');
	await expect(page.getByRole('button', { name: 'update ready · reload' })).toBeHidden();
});

test('a closed offer waits under the version', async ({ page, server, isMobile }) => {
	await settle(page);
	deploy(server);
	await check(page);
	const popup = page.getByRole('region', { name: 'new version' });
	await popup.getByRole('button', { name: 'not now' }).click();
	await expect(popup).toBeHidden();

	// Moves within the page, as a person would; a fresh load would be a new launch.
	if (isMobile) await page.getByRole('link', { name: 'more' }).last().click();
	else await page.keyboard.press(',');
	const later = page.getByRole('button', { name: 'update ready · reload' });
	await expect(later).toBeVisible();
	await shot(page, 'update-later');
	await expect(popup).toBeHidden();

	const reloaded = page.waitForEvent('load');
	await later.click();
	await reloaded;
	await expect(page.locator('main')).toBeVisible();
	await expect(later).toBeHidden();
});
