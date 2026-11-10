import type { Page } from '@playwright/test';
import { expect, hold, open, planDay, row, setClock, tap, test } from './support/fixtures';
import { addDays, at, TODAY } from './support/seed';

const switches = (page: Page) => page.getByRole('main').locator('header').getByRole('img').first();
const focus = (page: Page) => page.getByRole('region', { name: 'now' });
const ribbon = (page: Page) => page.getByRole('region', { name: /^the day/ });
const why = (page: Page) => page.getByRole('group', { name: 'why the switch?' });

async function expectTicks(page: Page, title: string, n: number) {
	await expect(row(page, title)).toHaveAccessibleName(
		new RegExp(` ${n} ${n === 1 ? 'tick' : 'ticks'} `)
	);
}

async function rest(page: Page, touch: boolean) {
	const button = page.getByRole('button', { name: /^rest/ }).first();
	await tap(button, touch);
}

test('the open-the-day sheet builds the board in the order typed', async ({ page }) => {
	await planDay(page, ['write the report', 'answer email', 'stretch']);
	const board = page.getByRole('region', { name: "today's watch" });
	await expect(board.getByText('3 tasks')).toBeVisible();
	await expect(board.getByRole('listitem')).toHaveText([
		/write the report/,
		/answer email/,
		/stretch/
	]);
	await expect(focus(page)).toContainText('nothing on watch');
});

test('the next morning offers what was planned yesterday', async ({ page }) => {
	await planDay(page, ['carry me', 'and me']);
	await setClock(page, at(addDays(TODAY, 1), '08:30'));
	await page.reload();
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByRole('heading', { name: 'open the day' })).toBeVisible();
	const carried = sheet
		.getByRole('region')
		.or(sheet.locator('section'))
		.filter({
			has: page.getByRole('heading', { name: 'from yesterday' })
		});
	await expect(carried.getByRole('button')).toHaveText([/carry me/, /and me/]);
	await carried.getByRole('button', { name: /carry me/ }).click();
	await sheet.getByRole('button', { name: 'start the day' }).click();
	await expect(row(page, 'carry me')).toBeVisible();
	await expect(row(page, 'and me')).toBeHidden();
});

test('tap, hold, release, rest, and end the day count as the switching table says', async ({
	page,
	touch
}) => {
	await setClock(page, at(TODAY, '08:55'));
	await planDay(page, ['alpha', 'beta', 'gamma']);

	await setClock(page, at(TODAY, '09:00'));
	await tap(row(page, 'alpha'), touch);
	await expect(focus(page)).toContainText('watching');
	await expect(focus(page)).toContainText('alpha');
	await expect(switches(page)).toHaveAccessibleName('0');
	await expectTicks(page, 'alpha', 1);
	await expect(why(page), 'a start asks nothing').toBeHidden();

	await setClock(page, at(TODAY, '09:10'));
	await tap(row(page, 'beta'), touch);
	await expect(switches(page)).toHaveAccessibleName('1');
	await expectTicks(page, 'beta', 1);
	await why(page).getByRole('button', { name: 'urge' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'noted · urge' })).toBeVisible();

	await setClock(page, at(TODAY, '09:20'));
	await tap(row(page, 'beta'), touch);
	await expect(switches(page), 'a repeat tap is not a switch').toHaveAccessibleName('1');
	await expectTicks(page, 'beta', 1);

	await setClock(page, at(TODAY, '09:30'));
	await hold(page, row(page, 'alpha'));
	await expect(focus(page)).toContainText('juggling · 2');
	await expect(switches(page)).toHaveAccessibleName('2');
	await expectTicks(page, 'alpha', 2);
	await expect(row(page, 'alpha')).toHaveAttribute('aria-pressed', 'true');
	await expect(row(page, 'beta')).toHaveAttribute('aria-pressed', 'true');

	await setClock(page, at(TODAY, '09:40'));
	await hold(page, row(page, 'alpha'));
	await expect(focus(page), 'holding a juggled task lets go of it').toContainText('watching');
	await expect(row(page, 'alpha')).toHaveAttribute('aria-pressed', 'false');
	await expect(switches(page)).toHaveAccessibleName('2');
	await expectTicks(page, 'alpha', 2);

	await setClock(page, at(TODAY, '09:50'));
	await hold(page, row(page, 'gamma'));
	await expect(switches(page)).toHaveAccessibleName('3');
	await setClock(page, at(TODAY, '10:00'));
	await tap(row(page, 'gamma'), touch);
	await expect(focus(page), 'a tap inside a juggle narrows it').toContainText('watching');
	await expect(switches(page)).toHaveAccessibleName('3');
	await expectTicks(page, 'gamma', 1);

	await setClock(page, at(TODAY, '10:10'));
	await rest(page, touch);
	await expect(focus(page)).toContainText('resting');
	await setClock(page, at(TODAY, '10:20'));
	await tap(row(page, 'gamma'), touch);
	await expect(switches(page), 'coming back from rest resumes').toHaveAccessibleName('3');
	await expectTicks(page, 'gamma', 2);

	await setClock(page, at(TODAY, '10:30'));
	await rest(page, touch);
	await setClock(page, at(TODAY, '10:40'));
	await tap(row(page, 'alpha'), touch);
	await expect(switches(page), 'leaving rest for another task switches').toHaveAccessibleName('4');
	await expectTicks(page, 'alpha', 3);

	await setClock(page, at(TODAY, '10:50'));
	await rest(page, touch);
	await setClock(page, at(TODAY, '11:00'));
	await expect(ribbon(page)).toContainText(/watched 1h(29|30) · rest 30m/);

	await page.getByRole('button', { name: 'end the day' }).click();
	await expect(focus(page)).toContainText('nothing on watch');
	const ended = page.getByRole('status').filter({ hasText: 'day ended at' });
	await expect(ended).toContainText('11:00');
	await ended.getByRole('button', { name: 'undo' }).click();
	await expect(focus(page), 'undo brings the day back').toContainText('resting');
	await expect(switches(page)).toHaveAccessibleName('4');
});

test('leaving a task due soon says so, once, without scolding', async ({ page, touch }) => {
	await planDay(page, ['the grant', 'coffee']);
	await page.getByRole('button', { name: 'arrange' }).click();
	await row(page, 'the grant').click();
	const sheet = page.getByRole('dialog');
	await sheet.getByRole('button', { name: 'deadline' }).click();
	await sheet.getByLabel('deadline').fill(`${TODAY}T10:30`);
	await sheet.getByRole('button', { name: 'save' }).click();
	await expect(sheet).toBeHidden();
	await page
		.getByRole('region', { name: "today's watch" })
		.getByRole('button', { name: 'done' })
		.click();
	await expect(row(page, 'the grant')).toContainText('2h 25m');

	await tap(row(page, 'the grant'), touch);
	await setClock(page, at(TODAY, '09:15'));
	await tap(row(page, 'coffee'), touch);
	await expect(page.getByRole('status').filter({ hasText: 'due in' })).toHaveText(
		/the grant due in 1h 15m\s*just so you know/
	);
});

test('the board answers the number keys and r', async ({ page, touch }) => {
	test.skip(touch, 'a keyboard is a desktop thing');
	await planDay(page, ['one', 'two']);
	await page.keyboard.press('2');
	await expect(row(page, 'two')).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Shift+1');
	await expect(focus(page)).toContainText('juggling · 2');
	await page.keyboard.press('r');
	await expect(focus(page)).toContainText('resting');
	await page.keyboard.press('n');
	await expect(
		page.getByRole('dialog').getByRole('heading', { name: 'add to today' })
	).toBeVisible();
});

test('a tap survives closing the page right after it', async ({ page, touch }) => {
	await planDay(page, ['durable']);
	await tap(row(page, 'durable'), touch);
	await page.waitForTimeout(50);
	await page.close({ runBeforeUnload: false });
	const context = page.context();
	const again = await context.newPage();
	await open(again);
	await expect(row(again, 'durable')).toHaveAttribute('aria-pressed', 'true');
});
