import { expect, openMenu, startNewGame, state, test, waitForTick } from './fixtures';
import type { Page } from '@playwright/test';

async function quitToMenu(page: Page): Promise<void> {
  await page.locator('#pause').dispatchEvent('click');
  await page.getByRole('button', { name: 'Quit to menu' }).click();
  await expect(page.getByRole('heading', { name: 'Ant Simulator' })).toBeVisible();
}

test('a quit game is saved as a replay that can be watched, sought and exited', async ({
  page,
  errors,
}) => {
  test.setTimeout(120_000);
  void errors;
  await openMenu(page);
  await startNewGame(page, { seed: '777', tutorial: false });
  await page.locator('#speeds').getByRole('button', { name: '4x' }).dispatchEvent('click');
  const played = await waitForTick(page, 260);
  expect(played.mode).toBe('playing');
  await quitToMenu(page);

  await page.getByRole('button', { name: 'Replays' }).click();
  await expect(page.getByText('Quick game · normal · seed 777')).toBeVisible();
  await page.getByRole('button', { name: 'Watch' }).first().click();

  await expect(page.locator('#replay-bar')).toBeVisible();
  await expect.poll(async () => (await state(page)).mode).toBe('replay');
  const first = await waitForTick(page, 20);
  expect(first.replay?.end).toBeGreaterThanOrEqual(200);

  // Fast playback reaches the end and stops there.
  await page.locator('#replay-bar [data-speed="16"]').click();
  await expect
    .poll(async () => {
      const s = await state(page);
      return s.replay ? s.replay.tick >= s.replay.end : false;
    })
    .toBe(true);
  await expect(page.locator('#replay-play')).toHaveText('Replay');

  // Seek back to the middle via the scrubber.
  await page.locator('#replay-scrub').evaluate((el: HTMLInputElement) => {
    el.value = String(Math.floor((Number(el.max) + Number(el.min)) / 2));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect
    .poll(async () => {
      const s = await state(page);
      return s.replay ? s.replay.tick < s.replay.end : false;
    })
    .toBe(true);
  await expect(page.locator('#replay-banner')).toBeHidden();

  await page.locator('#replay-exit').click();
  await expect(page.getByRole('heading', { name: 'Ant Simulator' })).toBeVisible();
  expect((await state(page)).mode).toBe('menu');
});

test('the daily challenge shows today’s card and records a quit attempt as the counting one', async ({
  page,
  errors,
}) => {
  test.setTimeout(90_000);
  void errors;
  await openMenu(page);
  await page.getByRole('button', { name: 'Daily Challenge' }).click();
  const today = new Date().toISOString().slice(0, 10);
  await expect(page.getByRole('heading', { name: today })).toBeVisible();
  await expect(page.getByText('Your first attempt today is the one that counts.')).toBeVisible();
  await page.getByRole('button', { name: "Play today's challenge" }).click();

  const running = await waitForTick(page, 5);
  expect(running.daily).toMatchObject({ date: today, attempt: 1 });
  await quitToMenu(page);

  await page.getByRole('button', { name: 'Daily Challenge' }).click();
  await expect(page.getByText(/Counting attempt: Gave up after/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry (not counted)' })).toBeVisible();
});
