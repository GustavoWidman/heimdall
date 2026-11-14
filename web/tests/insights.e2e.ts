import { expect, open, shot, test } from './support/fixtures';
import { addDays, at, busyToday, history, Seed, TODAY } from './support/seed';

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

test('the tasks card marks the measure it ranks by', async ({ page, request }) => {
	await busyToday(history(30)).push(request);
	await open(page, '/insights');
	const measures = page.getByRole('group', { name: 'rank tasks by' });
	await expect(measures.getByRole('button', { name: 'into' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await measures.getByRole('button', { name: 'time' }).click();
	await expect(measures.getByRole('button', { name: 'time' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(measures.getByRole('button', { name: 'into' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
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

test('the tags card shows which tag takes the switches, the focus and the juggling', async ({
	page,
	request
}, info) => {
	const yday = addDays(TODAY, -1);
	await new Seed()
		.task('seed_report', 'quarterly report', 32, { area: 'work' })
		.task('seed_inbox', 'inbox', 200, { area: 'work' })
		.task('seed_essay', 'essay', 140, { area: 'college' })
		.task('seed_dentist', 'call the dentist', 350)
		.mark(at(yday, '09:00'), { k: 'tap', task: 'seed_report' })
		.mark(at(yday, '10:00'), { k: 'tap', task: 'seed_essay' })
		.mark(at(yday, '11:00'), { k: 'tap', task: 'seed_inbox' })
		.mark(at(yday, '12:00'), { k: 'tap', task: 'seed_report' })
		.mark(at(yday, '12:30'), { k: 'hold', task: 'seed_dentist' })
		.mark(at(yday, '13:00'), { k: 'off' })
		.push(request);
	await open(page, '/insights');
	const card = page.getByRole('region', { name: 'tags' });
	const measure = card.getByRole('group', { name: 'measure tags by' });

	await expect(card).toContainText('4 switches · 2 hard · 1 soft · 1 unsorted');
	await expect(card.getByRole('listitem')).toHaveText([
		/^work\s*50%\s*2\s*1 hard · 1 soft · 0 unsorted\s*$/,
		/^college\s*25%\s*1\s*1 hard · 0 soft · 0 unsorted\s*$/,
		/^no tag\s*25%\s*1\s*0 hard · 0 soft · 1 unsorted\s*$/
	]);
	await card.scrollIntoViewIfNeeded();
	await shot(page, `${info.project.name}-insights-tags`);

	await expect(measure.getByRole('button', { name: 'switches' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await measure.getByRole('button', { name: 'focus' }).click();
	await expect(measure.getByRole('button', { name: 'focus' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(card.getByRole('listitem')).toHaveText([
		/^work\s*69%\s*2h45\s*$/,
		/^college\s*25%\s*1h00\s*$/,
		/^no tag\s*6%\s*15m\s*$/
	]);

	await measure.getByRole('button', { name: 'juggle' }).click();
	await expect(card.getByRole('listitem')).toHaveText([
		/^work\s*50%\s*15m\s*$/,
		/^no tag\s*50%\s*15m\s*$/
	]);
});

test('the tags card asks for a tag while no task has one', async ({ page, request }) => {
	await new Seed()
		.task('seed_report', 'quarterly report', 32)
		.mark(at(addDays(TODAY, -1), '09:00'), { k: 'tap', task: 'seed_report' })
		.mark(at(addDays(TODAY, -1), '10:00'), { k: 'off' })
		.push(request);
	await open(page, '/insights');
	const card = page.getByRole('region', { name: 'tags' });
	await expect(card).toContainText('give tasks a tag, like work or college');
	await card.getByRole('link', { name: 'tasks' }).click();
	await expect(page).toHaveURL(/\/tasks$/);
});
