import { expect, openMenu, state, test, waitForTick } from './fixtures';

test('campaign: new → mating flight → map → enter the new colony → back', async ({
  page,
  errors,
}) => {
  void errors;
  await openMenu(page);
  await page.getByRole('button', { name: 'Campaign' }).click();
  await page.getByLabel('Seed').fill('2024');
  await page.getByRole('button', { name: 'New campaign' }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await expect.poll(async () => (await state(page)).campaign?.owned).toBe(1);
  const start = (await state(page)).campaign!.active;
  await expect(page.locator('#campaign-hud')).toBeVisible();
  await expect(page.locator('#campaign-hud')).toContainText('Patches 1/54');
  await waitForTick(page, 5);

  // Breeders take minutes to raise; hatch a batch so the flight button shows up.
  await page.evaluate(() =>
    window.__antDebug!.send([
      { type: 'spawnAnts', count: 60, x: 768, y: 768, colony: 0, caste: 2 },
    ]),
  );
  const fly = page.locator('#campaign-flight');
  await expect(fly).toBeVisible({ timeout: 20_000 });
  await fly.click();
  await expect(page.locator('#toast')).toContainText('Mating flight');
  await expect.poll(async () => (await state(page)).campaign!.owned).toBeGreaterThan(1);

  // The map pauses the game and lists the new colony as enterable.
  await page.locator('#campaign-map-btn').click();
  const map = page.locator('#campaign-map');
  await expect(map).toBeVisible();
  await expect.poll(async () => (await state(page)).paused).toBe(true);
  await expect(map.locator(`.cmap-cell[data-patch="${start}"]`)).toHaveClass(/active/);
  const target = map.locator('.cmap-cell.own-black:not(.active)').first();
  const patch = Number(await target.getAttribute('data-patch'));
  await target.click();
  await expect(map).toBeHidden();
  await expect.poll(async () => (await state(page)).campaign!.active).toBe(patch);
  await expect.poll(async () => (await state(page)).paused).toBe(false);
  await expect(page.locator('#toast')).toContainText('Entered');

  // And back to the start patch.
  await page.locator('#campaign-map-btn').click();
  await map.locator(`.cmap-cell[data-patch="${start}"]`).click();
  await expect.poll(async () => (await state(page)).campaign!.active).toBe(start);
  await expect(page.locator('#campaign-hud')).toBeVisible();
});
