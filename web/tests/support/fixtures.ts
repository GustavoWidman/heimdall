import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { at, TODAY } from './seed';
import { PASSWORD, startServer, type Server } from './server';

export { expect };

type Device = {
	/** A fresh browser with its own storage, on the test's server, at the test's clock. */
	(opts?: { signedIn?: boolean }): Promise<Page>;
};

type Options = {
	/** The fake wall clock every device starts at, in epoch ms; null leaves the real clock. */
	startAt: number | null;
	/** Whether a new device already holds a session cookie. */
	signedIn: boolean;
	/** Network failures a test causes on purpose show up as console errors; let them. */
	networkErrorsOk: boolean;
};

type Fixtures = {
	server: Server;
	device: Device;
	/** Console and page errors from every device of the test; must stay empty. */
	errors: string[];
	touch: boolean;
};

const NETWORK =
	/Failed to load resource|net::|NetworkError|Load failed|EventSource|access control checks|network connection was lost|Could not connect/i;

export const test = base.extend<Options & Fixtures, { hashFile: string }>({
	startAt: [at(TODAY, '08:05'), { option: true }],
	signedIn: [true, { option: true }],
	networkErrorsOk: [false, { option: true }],

	hashFile: [
		// eslint-disable-next-line no-empty-pattern
		async ({}, use) => use(process.env.HEIMDALL_E2E_HASH_FILE as string),
		{ scope: 'worker' }
	],

	server: async ({ hashFile }, use) => {
		const server = await startServer(hashFile);
		await use(server);
		await server.dispose();
	},

	baseURL: async ({ server }, use) => use(server.url),

	touch: async ({ hasTouch }, use) => use(hasTouch),

	errors: async ({}, use) => use([]),

	device: async (
		{
			browser,
			server,
			startAt,
			signedIn,
			networkErrorsOk,
			errors,
			viewport,
			hasTouch,
			isMobile,
			deviceScaleFactor,
			timezoneId,
			colorScheme,
			locale
		},
		use
	) => {
		const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
		await use(async (opts = {}) => {
			const context = await browser.newContext({
				baseURL: server.url,
				viewport,
				hasTouch,
				isMobile,
				deviceScaleFactor,
				timezoneId,
				colorScheme,
				locale
			});
			contexts.push(context);
			if (startAt !== null) await context.clock.install({ time: startAt });
			if (opts.signedIn ?? signedIn) {
				const res = await context.request.post('/api/login', { data: { password: PASSWORD } });
				expect(res.ok(), 'signed in').toBe(true);
			}
			const page = await context.newPage();
			const n = contexts.length;
			page.on('pageerror', (e) => errors.push(`device ${n} pageerror: ${e.message}`));
			page.on('console', (m) => {
				if (m.type() !== 'error') return;
				if (networkErrorsOk && NETWORK.test(m.text())) return;
				errors.push(`device ${n} console: ${m.text()}`);
			});
			return page;
		});
		for (const c of contexts) await c.close();
		expect(errors, 'no page or console errors').toEqual([]);
	},

	page: async ({ device }, use) => use(await device())
});

/** Opens a screen and waits until the app has mounted on it. */
export async function open(page: Page, path = '/'): Promise<void> {
	await page.goto(path);
	await expect(page.locator('main')).toBeVisible();
}

/** Opens the app on an empty day and closes the open-the-day sheet. */
export async function openEmpty(page: Page): Promise<void> {
	await open(page);
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();
	await sheet.getByRole('button', { name: 'done' }).click();
	await expect(sheet).toBeHidden();
}

/** Builds today's board through the open-the-day sheet. */
export async function planDay(page: Page, titles: readonly string[]): Promise<void> {
	await open(page);
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByRole('heading', { name: 'open the day' })).toBeVisible();
	const input = sheet.getByLabel('a new task');
	for (const title of titles) {
		await input.fill(title);
		await input.press('Enter');
		await expect(input).toHaveValue('');
	}
	await sheet.getByRole('button', { name: 'start the day' }).click();
	await expect(sheet).toBeHidden();
}

function escape(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
}

/** A task's row on the Today board. */
export function row(page: Page, title: string): Locator {
	return page
		.getByRole('region', { name: "today's watch" })
		.getByRole('button', { name: new RegExp(`^${escape(title)} `) });
}

/** Taps a task the way the device would: a finger on the phone, a click on desktop. */
export async function tap(target: Locator, touch: boolean): Promise<void> {
	if (touch) await target.tap();
	else await target.click();
}

/** Presses and holds a task until the hold fires, then lifts. */
export async function hold(page: Page, target: Locator): Promise<void> {
	const box = await target.boundingBox();
	if (!box) throw new Error('nothing to hold');
	await page.mouse.move(box.x + 40, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(550);
	await page.mouse.up();
}

/** Moves every device's wall clock without firing the timers in between. */
export async function setClock(page: Page, when: number): Promise<void> {
	await page.clock.setSystemTime(when);
}

/** Saves a screenshot when `E2E_SHOTS` names a folder, for looking at the screens by eye. */
export async function shot(page: Page, name: string, fullPage = false): Promise<void> {
	const dir = process.env.E2E_SHOTS;
	if (!dir) return;
	mkdirSync(dir, { recursive: true });
	await page.screenshot({ path: join(dir, `${name}.png`), fullPage });
}
