import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Builds the Android app's overlay page (android/web) with the shared core
 * into the app's assets. `npm run build:android-web` runs it, after copying
 * the Stockfish files the extension also ships.
 */
const repo = fileURLToPath(new URL('../..', import.meta.url));
const outDir = resolve(repo, 'android/app/src/main/assets/web');
const ENGINE_FILES = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm', 'STOCKFISH-LICENSE.txt'];

export default defineConfig({
  root: resolve(repo, 'android/web'),
  base: './',
  publicDir: false,
  resolve: { alias: { '@core': resolve(repo, 'core') } },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
  },
  plugins: [
    {
      name: 'vektra-engine-files',
      apply: 'build',
      closeBundle() {
        mkdirSync(resolve(outDir, 'engine'), { recursive: true });
        for (const file of ENGINE_FILES) {
          copyFileSync(resolve(repo, 'extension/public/engine', file), resolve(outDir, 'engine', file));
        }
      },
    },
  ],
});
