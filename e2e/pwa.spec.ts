import { expect, openMenu, test } from './fixtures';

// Service workers and installability are checked on Chromium only.
test.describe('PWA', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium only');

  test('manifest is valid and linked', async ({ page, errors }) => {
    void errors;
    await openMenu(page);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const res = await page.request.get(new URL(href!, page.url()).toString());
    const manifest = (await res.json()) as {
      name: string;
      display: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(manifest.name).toBe('Ant Simulator');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((i) => i.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const r = await page.request.get(new URL(icon.src, page.url()).toString());
      expect(r.ok()).toBe(true);
    }
  });

  test('loads offline once the service worker is active', async ({ page, context, errors }) => {
    void errors;
    await openMenu(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    // Wait for the worker to take control and finish precaching.
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Ant Simulator' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__antDebug!.state().tick))
      .toBeGreaterThan(0);
  });
});
