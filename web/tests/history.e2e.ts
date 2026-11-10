import { expect, open, test } from './support/fixtures';
import { at, busyToday, history, TODAY } from './support/seed';

test.describe('with a busy day', () => {
	test.use({ startAt: at(TODAY, '15:42') });

	test('every ledger entry reads in at most two lines', async ({ page, request }) => {
		await busyToday(history(3)).push(request);
		await open(page, `/history/${TODAY}`);
		const ledger = page.getByRole('region', { name: 'switch ledger' }).last();
		await expect(ledger.getByRole('listitem')).toHaveCount(17);
		const tall = await ledger.getByRole('listitem').evaluateAll((items) =>
			items.flatMap((li) => {
				const move = li.querySelector('.move') as HTMLElement;
				const line = parseFloat(getComputedStyle(move).lineHeight) || 18;
				const lines = Math.round(move.getBoundingClientRect().height / line);
				return lines > 2
					? [`${lines} lines: ${move.textContent?.replace(/\s+/g, ' ').trim()}`]
					: [];
			})
		);
		expect(tall).toEqual([]);
	});
});
