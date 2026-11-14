import { expect, open, shot, test } from './support/fixtures';
import { addDays, at, busyToday, history, Seed, TODAY } from './support/seed';

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

test('hard switches show on the day, the week, the month and the year', async ({
	page,
	request
}, info) => {
	const yday = addDays(TODAY, -1);
	await new Seed()
		.task('seed_report', 'quarterly report', 32, { area: 'work' })
		.task('seed_inbox', 'inbox', 200, { area: 'work' })
		.task('seed_essay', 'essay', 140, { area: 'college' })
		.mark(at(yday, '09:00'), { k: 'tap', task: 'seed_report' })
		.mark(at(yday, '10:00'), { k: 'tap', task: 'seed_essay' })
		.mark(at(yday, '11:00'), { k: 'tap', task: 'seed_inbox' })
		.mark(at(yday, '12:00'), { k: 'tap', task: 'seed_report' })
		.mark(at(yday, '13:00'), { k: 'off' })
		.push(request);

	await open(page, `/history/${yday}`);
	const hard = page.locator('.totals > div', { has: page.getByRole('term').getByText('hard') });
	await expect(hard).toHaveText(/hard\s*2/);

	await open(page, `/week/${TODAY}`);
	await expect(page.getByRole('row', { name: /^hard switches/ })).toContainText('2');

	await open(page, '/month');
	await expect(page.getByRole('paragraph').filter({ hasText: 'watched' })).toContainText(
		'3 switches, 2 of them hard, over 1 day watched'
	);

	await open(page, '/year');
	const chip = page.getByRole('button', { name: 'hard switches' });
	await chip.click();
	await expect(chip).toHaveAttribute('aria-pressed', 'true');
	const months = page.getByRole('region', { name: 'hard switches by month' });
	await expect(months.getByRole('link', { name: 'nov: 2 hard switches' })).toBeVisible();
	await shot(page, `${info.project.name}-year-hard`);
});
