import { expect, planDay, test } from './support/fixtures';

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
