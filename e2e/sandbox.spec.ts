import { expect, openMenu, startSandbox, state, test, waitForTick } from './fixtures';

test('sandbox: setup → paint rocks → tune → 8x → save is labelled → normal game has no toolbar', async ({
  page,
  errors,
}) => {
  void errors;
  await openMenu(page);
  await startSandbox(page, { seed: '4242' });
  expect((await state(page)).seed).toBe(4242);
  await waitForTick(page, 10);

  // The toolbar is there (phones start with it collapsed); open it.
  const toggle = page.locator('#sandbox-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();

  // Tool mode: pick Rocks, tap the yard, a rock appears; the ant is not sent walking.
  const before = (await state(page)).player!;
  await page.locator('#sandbox [data-tool="rock"]').click();
  expect((await state(page)).tool).toBe(true);
  // Left of the centre, clear of the toolbar and the joystick on phones, but beyond the nest's rock-free zone.
  const box = (await page.locator('#app canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 135, box.y + box.height / 2 - 32);
  await expect.poll(async () => (await state(page)).rocks).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const after = (await state(page)).player!;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(40);

  // Back to pan mode hands the gesture back.
  await page.locator('#sandbox [data-tool="pan"]').click();
  expect((await state(page)).tool).toBe(false);

  // Parameters panel opens and resets.
  await page.locator('#sandbox-tune').click();
  const params = page.locator('#sandbox-params');
  await expect(params).toBeVisible();
  const speedSlider = params.getByLabel('Walking speed');
  await speedSlider.fill('80');
  await expect(speedSlider).toHaveValue('80');
  await params.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(speedSlider).toHaveValue('40');
  await params.getByRole('button', { name: 'Close' }).click();
  await expect(params).toBeHidden();

  // Time goes up to 8x.
  await page.getByRole('button', { name: '8x', exact: true }).click();
  expect((await state(page)).speed).toBe(8);

  // Saves are labelled as sandbox saves.
  await page.locator('#saves').click();
  await page
    .locator('#save-menu .save-row[data-slot="slot1"]')
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(page.locator('#toast')).toContainText('Saved to Slot 1');
  await expect(page.locator('#save-menu .save-row[data-slot="slot1"]')).toContainText('Sandbox');

  // A normal game afterwards: no toolbar, no 8x.
  await page.keyboard.press('Escape'); // closes the saves popup
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Quit to menu' }).click();
  await expect.poll(async () => (await state(page)).mode).toBe('menu');
  await page.getByRole('button', { name: 'New Game' }).click();
  await page.getByLabel('Seed').fill('9');
  await page.getByLabel('Show tutorial').setChecked(false);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect.poll(async () => (await state(page)).mode).toBe('playing');
  await expect.poll(async () => (await state(page)).sandbox).toBe(false);
  await expect(page.locator('#sandbox')).toBeHidden();
  await expect(page.getByRole('button', { name: '8x', exact: true })).toBeHidden();
  expect((await state(page)).speed).toBe(4);
});
