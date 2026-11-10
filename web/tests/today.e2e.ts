import type { Page } from '@playwright/test';
import { expect, hold, open, planDay, row, setClock, tap, test } from './support/fixtures';
import { addDays, at, busyToday, history, TODAY } from './support/seed';

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
	// Two ten-minute juggles add twenty minutes of load on top of the focus.
	await expect(ribbon(page)).toContainText(/watched 1h(29|30) · load 1h(49|50) ×1\.2 · rest 30m/);

	await page.getByRole('button', { name: 'end the day' }).click();
	await expect(focus(page)).toContainText('nothing on watch');
	const ended = page.getByRole('status').filter({ hasText: 'day ended at' });
	await expect(ended).toContainText('11:00');
	await ended.getByRole('button', { name: 'undo' }).click();
	await expect(focus(page), 'undo brings the day back').toContainText('resting');
	await expect(switches(page)).toHaveAccessibleName('4');
});

test('the toast after a tick undoes it, or moves it a few minutes earlier', async ({
	page,
	touch
}) => {
	const toast = page.getByRole('region', { name: 'after the switch' });
	await setClock(page, at(TODAY, '08:55'));
	await planDay(page, ['alpha', 'beta']);

	await setClock(page, at(TODAY, '09:20'));
	await tap(row(page, 'alpha'), touch);
	await expect(toast).toContainText('started alpha');
	await toast.getByRole('button', { name: 'earlier' }).click();
	await toast.getByRole('button', { name: '−15m' }).click();
	await expect(toast).toContainText('it began at 09:05');
	await expect(focus(page)).toContainText('since 09:05');

	await setClock(page, at(TODAY, '09:40'));
	await tap(row(page, 'beta'), touch);
	await expect(switches(page)).toHaveAccessibleName('1');
	await expect(toast.getByRole('button', { name: 'undo' }), 'the last toast has left').toHaveCount(
		1
	);
	await toast.getByRole('button', { name: 'undo' }).click();
	await expect(toast.getByRole('status')).toHaveText('undone');
	await expect(switches(page)).toHaveAccessibleName('0');
	await expect(row(page, 'alpha')).toHaveAttribute('aria-pressed', 'true');
	await expectTicks(page, 'beta', 0);

	await setClock(page, at(TODAY, '09:45'));
	await tap(row(page, 'beta'), touch);
	await expect(toast.getByRole('button', { name: 'earlier' })).toHaveCount(1);
	await toast.getByRole('button', { name: 'earlier' }).click();
	await expect(
		toast.getByRole('button', { name: '−1h' }),
		'never back past the tick before it'
	).toBeDisabled();
	await toast.getByRole('button', { name: '−30m' }).click();
	await expect(focus(page)).toContainText('since 09:15');
	await expect(row(page, 'alpha')).toContainText('10m');

	await focus(page)
		.getByRole('button', { name: /^since 09:15/ })
		.click();
	await expect(page.getByRole('dialog').getByRole('heading')).toHaveText(
		/09:15\s*switched to\s*beta/
	);
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

test('holding a number key juggles like holding a finger', async ({ page, touch }) => {
	test.skip(touch, 'a keyboard is a desktop thing');
	await planDay(page, ['one', 'two']);
	await page.keyboard.press('1');
	await expect(focus(page)).toContainText('watching');

	await setClock(page, at(TODAY, '08:15'));
	await page.keyboard.down('2');
	await page.waitForTimeout(550);
	await expect(focus(page), 'the hold fires before the key comes up').toContainText('juggling · 2');
	await page.keyboard.up('2');
	await expect(focus(page)).toContainText('juggling · 2');
	await expect(switches(page)).toHaveAccessibleName('1');

	await page.keyboard.down('2');
	await page.waitForTimeout(550);
	await page.keyboard.up('2');
	await expect(focus(page), 'holding a juggled task lets go of it').toContainText('watching');
	await expect(row(page, 'two')).toHaveAttribute('aria-pressed', 'false');
	await expect(row(page, 'one')).toHaveAttribute('aria-pressed', 'true');
});

test('hover actions on a juggled row leave its text uncovered', async ({ page, touch }) => {
	test.skip(touch, 'hover actions exist only with a mouse');
	const long = 'a fairly long task title for the board';
	await planDay(page, [long, 'short']);
	await row(page, 'short').click();
	await setClock(page, at(TODAY, '09:40'));
	await page.keyboard.press('Shift+1');
	await expect(focus(page)).toContainText('juggling · 2');
	await row(page, long).hover();
	const item = page.getByRole('region', { name: "today's watch" }).getByRole('listitem').first();
	await expect(item.getByRole('button', { name: 'let go' })).toBeVisible();
	await page.waitForTimeout(400);
	const covered = await item.evaluate((li) => {
		const acts = li.querySelector('.acts')!.getBoundingClientRect();
		const column = li.querySelector('.t')!.getBoundingClientRect();
		const texts = [...li.querySelectorAll('.t span')].filter((s) => s.children.length === 0);
		return texts
			.filter((s) => {
				const r = s.getBoundingClientRect();
				const left = Math.max(r.left, column.left);
				const right = Math.min(r.right, column.right);
				return right > left && right > acts.left && left < acts.right;
			})
			.map((s) => s.textContent?.trim());
	});
	expect(covered, 'text running under the hover actions').toEqual([]);
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

test.describe('on a busy day', () => {
	test.use({ startAt: at(TODAY, '15:42') });

	test('a row shows each detail whole or not at all', async ({ page, request }) => {
		await busyToday(history(3)).push(request);
		await open(page);
		await expect(switches(page)).toHaveAccessibleName('15');
		await page.mouse.move(0, 0);
		const cut = await page
			.getByRole('region', { name: "today's watch" })
			.getByRole('listitem')
			.evaluateAll((items) =>
				items.flatMap((li) => {
					const line = li.querySelector('.m')!.getBoundingClientRect();
					return [...li.querySelectorAll('.m > *')].flatMap((el) => {
						const r = el.getBoundingClientRect();
						const shown = r.left < line.right && r.top < line.bottom;
						const whole = r.right <= line.right + 0.5 && r.bottom <= line.bottom + 0.5;
						return shown && !whole ? [el.textContent?.trim()] : [];
					});
				})
			);
		expect(cut, 'details cut part way').toEqual([]);
	});
});
