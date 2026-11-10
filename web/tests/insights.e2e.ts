import { expect, open, test } from './support/fixtures';
import { addDays, at, busyToday, history, TODAY } from './support/seed';

test.use({ startAt: at(TODAY, '15:42') });

test('the window switches between 7, 30, and 90 days', async ({ page, request }) => {
	await busyToday(history(100)).push(request);
	await open(page, '/insights');
	const windows = page.getByRole('group', { name: 'window' });
	await expect(page.getByText('the last 30 days', { exact: true }).first()).toBeVisible();
	await windows.getByRole('button', { name: /^7/ }).click();
	await expect(page.getByText('the last 7 days', { exact: true }).first()).toBeVisible();
	await expect(windows.getByRole('button', { name: /^7/ })).toHaveAttribute('aria-pressed', 'true');
	await windows.getByRole('button', { name: /^90/ }).click();
	await expect(page.getByText('the last 90 days', { exact: true }).first()).toBeVisible();
});

test('a day picked on a chart opens that day in history', async ({ page, request, touch }) => {
	await busyToday(history(30)).push(request);
	await open(page, '/insights');
	const chart = page.getByRole('group', { name: /Arrow keys move between days/ }).first();
	const lastDay = chart.locator('[data-i]').last();
	if (touch) {
		await lastDay.tap();
		await page.getByRole('link', { name: 'tue 10 nov, so far' }).first().tap();
	} else {
		await lastDay.click();
	}
	await expect(page).toHaveURL(new RegExp(`/history/${TODAY}$`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^tue 10 nov/);
});

test('deadlines still ahead show next to those that passed', async ({ page, request }) => {
	const seed = busyToday(history(10));
	seed.task('seed_review', 'review pr #412', 280, { deadline: at(addDays(TODAY, 3), '12:00') });
	seed.task('seed_dentist', 'call the dentist', 350, { deadline: at(addDays(TODAY, -2), '10:00') });
	await seed.push(request);
	await open(page, '/insights');
	const card = page.getByRole('region', { name: 'deadline pressure' });
	await expect(card.getByRole('listitem')).toHaveText([
		/quarterly report.*due tue 10 nov, 17:52/,
		/review pr #412.*due fri 13 nov, 12:00/,
		/call the dentist.*due sun 8 nov, 10:00/
	]);
});
