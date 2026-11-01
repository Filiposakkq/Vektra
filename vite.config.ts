import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './extension/manifest.config.ts';
import { BUILD_STAMP_FILE, computeFingerprint } from './scripts/build-fingerprint.mjs';

/** The repository root; the extension's own files are under extension/. */
const repo = fileURLToPath(new URL('.', import.meta.url));

/**
 * Writes dist/vektra-build.json with a fingerprint of the build inputs, so the
 * e2e tests can refuse a stale dist (see tests/e2e/assertFreshBuild.mjs).
 * Production builds only: dev output gets no stamp.
 */
function buildStamp(): Plugin {
  let root = '';
  let outDir = '';
  let stamp = '';
  return {
    name: 'vektra-build-stamp',
    apply: 'build',
    configResolved(config) {
      // The inputs include core/ and package.json, outside the Vite root.
      root = repo;
      outDir = relative(root, resolve(config.root, config.build.outDir));
    },
    buildStart() {
      // The output folder is never an input, wherever it is configured.
      const { fingerprint, files } = computeFingerprint(root, { exclude: [outDir] });
      stamp = JSON.stringify(
        {
          fingerprint,
          fullEngineE2E: Boolean(process.env.VEKTRA_E2E_FULL_ENGINE),
          builtAt: new Date().toISOString(),
          files,
        },
        null,
        2,
      );
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: BUILD_STAMP_FILE, source: stamp });
    },
  };
}

// The Vite root is extension/, so built paths (src/popup/index.html...) are
// the same as before the repository had core/ and android/.
export default defineConfig({
  root: resolve(repo, 'extension'),
  resolve: { alias: { '@core': resolve(repo, 'core') } },
  plugins: [crx({ manifest }), buildStamp()],
  build: {
    target: 'es2022',
    outDir: resolve(repo, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      // Not referenced from the manifest, so listed here to be built.
      input: { offscreen: resolve(repo, 'extension/src/engine/offscreen.html') },
    },
  },
});
