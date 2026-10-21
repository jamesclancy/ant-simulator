import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const ci = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  ...(ci ? { workers: 2 } : {}),
  reporter: ci ? [['github'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 14'] } },
  ],
  // Production build with the `e2e` mode (exposes window.__antDebug), served by `vite preview`.
  webServer: {
    command: `pnpm --filter @ant/web exec vite build --mode e2e --outDir dist-e2e && pnpm --filter @ant/web exec vite preview --mode e2e --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !ci,
    timeout: 180_000,
  },
});
