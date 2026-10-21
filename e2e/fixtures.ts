import { expect, test as base, type Page } from '@playwright/test';
import type { AntDebugState } from '../apps/web/src/env';

/** Fails a test on any console error or uncaught page error. */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await use(errors);
    expect(errors, 'no console or page errors').toEqual([]);
  },
});
export { expect };

export const state = (page: Page): Promise<AntDebugState> =>
  page.evaluate(() => window.__antDebug!.state());

export async function waitForTick(page: Page, atLeast: number): Promise<AntDebugState> {
  await expect
    .poll(async () => (await state(page)).tick, { timeout: 30_000 })
    .toBeGreaterThan(atLeast);
  return state(page);
}

/**
 * Open the page at the main menu and wait for the sim backdrop to be running. The device tier is
 * pinned to `low`: it keeps rendering cheap on the shared CI runners (a saturated renderer starved
 * Playwright's own page commands) and stops the perf governor re-profiling mid-test.
 */
export async function openMenu(page: Page, query = ''): Promise<void> {
  const params = new URLSearchParams(query);
  params.set('tier', 'low');
  await page.goto(`/?${params}`);
  await expect(page.getByRole('heading', { name: 'Ant Simulator' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__antDebug)).toBe(true);
}

/** Main menu → New Game with a fixed seed. Tutorial left at its default (on for a first game). */
export async function startNewGame(
  page: Page,
  opts: { seed: string; difficulty?: 'Easy' | 'Normal' | 'Hard'; tutorial?: boolean },
): Promise<void> {
  await page.getByRole('button', { name: 'New Game' }).click();
  if (opts.difficulty) await page.getByRole('button', { name: opts.difficulty }).click();
  await page.getByLabel('Seed').fill(opts.seed);
  if (opts.tutorial !== undefined) await page.getByLabel('Show tutorial').setChecked(opts.tutorial);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await expect.poll(async () => (await state(page)).mode).toBe('playing');
}
