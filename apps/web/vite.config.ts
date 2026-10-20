import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the same build works on the web and inside the Capacitor web view.
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
