import { expect, openMenu, startNewGame, state, test, waitForTick } from './fixtures';

test('audio runs without console errors, mute persists, unlock happens on first gesture', async ({
  page,
  errors,
}) => {
  void errors;
  await openMenu(page);
  // A gesture unlocks the context and renders the sound bank.
  expect((await state(page)).audio.context).toBe('none');
  await page.mouse.click(10, 10);
  await expect.poll(async () => (await state(page)).audio.context).toBe('running');
  await startNewGame(page, { seed: '7', tutorial: false });
  await waitForTick(page, 5);
  await expect.poll(async () => (await state(page)).audio.track).toBe('game');
  const mute = page.locator('#mute');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Trail' }).click();
  await page.getByRole('button', { name: 'Pick up' }).click();
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).audio.masterGain).toBeLessThan(0.01);
  await waitForTick(page, 40);

  await openMenu(page);
  await startNewGame(page, { seed: '7', tutorial: false });
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'false');
});

test('menu music and settings audio controls work', async ({ page, errors }) => {
  void errors;
  await openMenu(page);
  await page.mouse.click(10, 10);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('checkbox', { name: 'Mute all sound' }).check();
  await page.getByRole('slider', { name: 'Music volume' }).fill('0.2');
  await page.getByRole('button', { name: 'Done' }).click();
  await startNewGame(page, { seed: '3', tutorial: false });
  await waitForTick(page, 20);
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
});
