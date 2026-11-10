import type { Page } from '@playwright/test';
import { expect, open, planDay, test } from './support/fixtures';
import { TODAY } from './support/seed';

const group = (page: Page, name: string) =>
	page.getByRole('region', { name: new RegExp(`^${name}`) });

async function unfold(page: Page, name: string) {
	const fold = page.getByRole('button', { name: new RegExp(`^${name}`) });
	if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click();
}

test('a task is created, edited, given a deadline, done, archived, and restored', async ({
	page
}) => {
	await open(page, '/tasks');
	await page.getByRole('button', { name: 'new task' }).click();
	const sheet = page.getByRole('dialog');
	await sheet.getByLabel('title').fill('file the taxes');
	await sheet.getByRole('button', { name: 'deadline' }).click();
	await sheet.getByLabel('deadline').fill(`${TODAY}T18:00`);
	await sheet.getByRole('button', { name: 'add task' }).click();
	await expect(sheet).toBeHidden();
	await expect(group(page, 'active')).toContainText('file the taxes');
	await expect(page.getByRole('region', { name: 'due in the next 7 days' })).toContainText(
		/tue\s*18:00\s*file the taxes\s*in 9h 55m/
	);

	await group(page, 'active')
		.getByRole('button', { name: /^file the taxes/ })
		.click();
	await sheet.getByLabel('title').fill('file the taxes, finally');
	await sheet.getByRole('button', { name: 'save' }).click();
	await expect(group(page, 'active')).toContainText('file the taxes, finally');

	await group(page, 'active')
		.getByRole('button', { name: /^file the taxes/ })
		.click();
	await sheet.getByRole('button', { name: 'mark done' }).click();
	await expect(group(page, 'active')).not.toContainText('file the taxes');
	await unfold(page, 'done');
	await expect(group(page, 'done')).toContainText('file the taxes, finally');

	await group(page, 'done')
		.getByRole('button', { name: /^file the taxes/ })
		.first()
		.click();
	await sheet.getByRole('button', { name: 'archive' }).click();
	await unfold(page, 'archived');
	await expect(group(page, 'archived')).toContainText('file the taxes, finally');
	await page.getByRole('button', { name: 'restore file the taxes, finally' }).click();
	await expect(group(page, 'active')).toContainText('file the taxes, finally');
});

test('a long board spreads its tasks over the palette before repeating a color', async ({
	page
}) => {
	const titles = Array.from({ length: 14 }, (_, i) => `task ${i + 1}`);
	await planDay(page, titles);
	const hues = await page
		.getByRole('region', { name: "today's watch" })
		.getByRole('listitem')
		.evaluateAll((items) =>
			items.map((li) => getComputedStyle(li.querySelector('.row')!).getPropertyValue('--h').trim())
		);
	expect(hues).toHaveLength(14);
	const uses = new Map<string, number>();
	for (const h of hues) uses.set(h, (uses.get(h) ?? 0) + 1);
	expect(new Set(hues.slice(0, 10)).size, 'the first ten all differ').toBe(10);
	expect(Math.max(...uses.values()), 'no color three times over').toBe(2);
});
