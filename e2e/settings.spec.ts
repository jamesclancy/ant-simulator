import { expect, openMenu, test } from './fixtures';

test('settings persist across reload', async ({ page, errors }) => {
  void errors;
  await openMenu(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const fps = page.getByRole('checkbox', { name: 'Show FPS' });
  const follow = page.getByRole('checkbox', { name: 'Camera follows your ant' });
  await expect(fps).not.toBeChecked();
  await expect(follow).toBeChecked();
  await fps.check();
  await follow.uncheck();
  await page.getByRole('combobox', { name: 'Joystick side' }).selectOption('right');
  await page.getByRole('button', { name: 'Done' }).click();

  await openMenu(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('checkbox', { name: 'Show FPS' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Camera follows your ant' })).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Joystick side' })).toHaveValue('right');
});
