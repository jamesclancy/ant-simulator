import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jamesclancy.antsimulator',
  appName: 'Ant Simulator',
  // The Vite build output of apps/web; build it first (see `pnpm mobile:sync`).
  webDir: '../web/dist',
  backgroundColor: '#1b2a1b',
  ios: { contentInset: 'never', scrollEnabled: false },
  plugins: {
    // Android: edge-to-edge with safe-area insets exposed to CSS; light icons on the dark game.
    SystemBars: { insetsHandling: 'css', style: 'DARK' },
    // iOS/Android status bar are styled at runtime in apps/web/src/platform/nativeShell.ts.
  },
};

export default config;
