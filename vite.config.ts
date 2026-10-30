import { relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';
import { BUILD_STAMP_FILE, computeFingerprint } from './scripts/build-fingerprint.mjs';

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
      root = config.root;
      outDir = relative(root, resolve(root, config.build.outDir));
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

export default defineConfig({
  plugins: [crx({ manifest }), buildStamp()],
  build: {
    target: 'es2022',
    rollupOptions: {
      // Not referenced from the manifest, so listed here to be built.
      input: { offscreen: 'src/engine/offscreen.html' },
    },
  },
});
