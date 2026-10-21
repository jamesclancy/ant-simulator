import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    // Determinism tests run thousands of ticks of a two-colony sim; shared CI runners are
    // several times slower than a dev machine, so the 5 s default flakes.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
