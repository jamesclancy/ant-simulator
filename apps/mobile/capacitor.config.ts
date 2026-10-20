import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jamesclancy.antsimulator',
  appName: 'Ant Simulator',
  // The Vite build output of apps/web; build it first (see `pnpm mobile:sync`).
  webDir: '../web/dist',
  backgroundColor: '#1b2a1b',
  ios: { contentInset: 'never', scrollEnabled: false },
};

export default config;
