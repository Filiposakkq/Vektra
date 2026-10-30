import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: 'es2022',
    rollupOptions: {
      // Not referenced from the manifest, so listed here to be built.
      input: { offscreen: 'src/engine/offscreen.html' },
    },
  },
});
