import { expect, openMenu, startNewGame, state, test, waitForTick } from './fixtures';

const SEED = '12345';

test('menu → new game → move → pause → save → reload → continue → quit → new game', async ({
  page,
  errors,
}) => {
  void errors;
  await openMenu(page);
  // No saves yet: no Continue button.
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);

  await startNewGame(page, { seed: SEED });
  expect((await state(page)).seed).toBe(Number(SEED));

  // First game shows the tutorial; skip it.
  const tutorial = page.locator('#tutorial');
  await expect(tutorial).toBeVisible();
  await tutorial.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(tutorial).toBeHidden();

  // Click the ground away from the player (the camera follows it, so the centre is the ant).
  const start = await waitForTick(page, 20);
  expect(start.player).not.toBeNull();
  const box = (await page.locator('#app canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 120, box.y + box.height / 2 - 60);
  await expect
    .poll(async () => {
      const p = (await state(page)).player!;
      return Math.hypot(p.x - start.player!.x, p.y - start.player!.y);
    })
    .toBeGreaterThan(10);

  // Pause menu and back.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  expect((await state(page)).paused).toBe(true);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('#menu')).toBeHidden();
  expect((await state(page)).paused).toBe(false);

  // Save to slot 1.
  await page.locator('#saves').click();
  await page
    .locator('#save-menu .save-row[data-slot="slot1"]')
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(page.locator('#toast')).toContainText('Saved to Slot 1');
  const saved = await state(page);

  // Reload: Continue restores the same game (tick at/after the save, same population shape).
  await openMenu(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await expect.poll(async () => (await state(page)).seed).toBeDefined();
  const restored = await expect
    .poll(async () => (await state(page)).population.length)
    .toBe(saved.population.length)
    .then(() => state(page));
  expect(restored.mode).toBe('playing');
  expect(restored.tick).toBeGreaterThanOrEqual(saved.tick - 5);
  expect(restored.tick).toBeLessThan(saved.tick + 20 * 60);
  expect(Math.abs(restored.population[0]! - saved.population[0]!)).toBeLessThan(30);
  const later = await waitForTick(page, restored.tick);
  expect(later.tick).toBeGreaterThan(restored.tick);

  // Quit to menu via the pause menu, then start another new game.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Quit to menu' }).click();
  await expect(page.getByRole('heading', { name: 'Ant Simulator' })).toBeVisible();
  await expect.poll(async () => (await state(page)).mode).toBe('menu');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

  await startNewGame(page, { seed: '777', tutorial: false });
  expect((await state(page)).seed).toBe(777);
  await expect(page.locator('#tutorial')).toBeHidden();
  await waitForTick(page, 10);
});

test('Esc opens and closes the pause menu', async ({ page, errors }) => {
  void errors;
  await openMenu(page);
  await startNewGame(page, { seed: SEED, tutorial: false });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
});

test('Esc closes the saves popup without opening the pause menu', async ({ page, errors }) => {
  void errors;
  await openMenu(page);
  await startNewGame(page, { seed: SEED, tutorial: false });
  await page.locator('#saves').click();
  await expect(page.locator('#save-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#save-menu')).toBeHidden();
  await expect(page.locator('#menu')).toBeHidden();
});
