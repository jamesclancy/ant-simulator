import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative asset URLs so the same build works on the web and inside the Capacitor web view.
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  plugins: [
    VitePWA({
      // The app registers the worker itself (src/pwa.ts) so it can skip native web views.
      injectRegister: false,
      registerType: 'prompt',
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Ant Simulator',
        short_name: 'Ants',
        description: 'Rule the yard. Lead your ant colony against the red colony.',
        theme_color: '#1d3316',
        background_color: '#1d3316',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell plus the sim worker bundle (both live under assets/).
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
