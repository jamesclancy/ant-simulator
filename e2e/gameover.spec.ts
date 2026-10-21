import { expect, openMenu, startNewGame, state, test, waitForTick } from './fixtures';

test('?debug raid ends the game with a Defeat modal and Play again restarts', async ({
  page,
  errors,
}) => {
  test.setTimeout(180_000);
  void errors;
  await openMenu(page, '?debug');
  await startNewGame(page, { seed: '4242', difficulty: 'Hard', tutorial: false });
  await waitForTick(page, 20);

  // The debug panel is collapsed on phones.
  await page.locator('details.tuning').evaluate((d: HTMLDetailsElement) => (d.open = true));

  // Turn the raid on and drop a big red force at the black nest, repeatedly, until the queen falls.
  await page.getByRole('button', { name: 'Red raid on' }).click();
  await page.evaluate(() => {
    const s = window.__antDebug!;
    const timer = setInterval(() => {
      if (s.state().winner !== -1) return clearInterval(timer);
      s.send([{ type: 'setRaid', colony: 1, on: true }]);
    }, 500);
  });
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: '+50 red soldiers at our nest' }).click();
  }
  await page.locator('#speeds').getByRole('button', { name: '4x' }).dispatchEvent('click');

  await expect(page.locator('#gameover')).toBeVisible({ timeout: 150_000 });
  await expect(page.locator('#gameover-title')).toHaveText('Defeat');
  expect((await state(page)).winner).not.toBe(-1);

  await page.getByRole('button', { name: 'Play again' }).click();
  await expect(page.locator('#gameover')).toBeHidden();
  const fresh = await waitForTick(page, 5);
  expect(fresh.winner).toBe(-1);
});
