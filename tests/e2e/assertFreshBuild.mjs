// Stops the e2e tests before they load a dist/ that was not built from the
// current sources: compares the fingerprint `npm run build` recorded in
// dist/vektra-build.json with one computed now.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BUILD_STAMP_FILE,
  computeFingerprint,
  diffFingerprintFiles,
} from '../../scripts/build-fingerprint.mjs';

const root = resolve(import.meta.dirname, '../..');
const MAX_LISTED = 10;

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

/**
 * fullEngine: the test needs a build made with VEKTRA_E2E_FULL_ENGINE=1.
 * Otherwise such a build only earns a warning, since it carries extra host
 * permissions meant for that test alone.
 */
export function assertFreshBuild({ fullEngine = false } = {}) {
  const stampPath = join(root, 'dist', BUILD_STAMP_FILE);
  if (!existsSync(stampPath)) {
    fail(`dist/${BUILD_STAMP_FILE} is missing. Run \`npm run build\` first (\`npm run dev\` output can't be tested).`);
  }
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch (error) {
    fail(`dist/${BUILD_STAMP_FILE} could not be read (${error.message}). Run \`npm run build\` again.`);
  }

  const current = computeFingerprint(root);
  if (stamp.fingerprint !== current.fingerprint) {
    const { added, removed, changed } = diffFingerprintFiles(stamp.files ?? {}, current.files);
    const lines = [
      ...changed.map((rel) => `  changed  ${rel}`),
      ...added.map((rel) => `  added    ${rel}`),
      ...removed.map((rel) => `  removed  ${rel}`),
    ];
    const more = lines.length > MAX_LISTED ? `\n  … and ${lines.length - MAX_LISTED} more` : '';
    fail(
      'dist was built from different sources. Run `npm run build` again.' +
        (lines.length ? `\n${lines.slice(0, MAX_LISTED).join('\n')}${more}` : ''),
    );
  }

  if (fullEngine && !stamp.fullEngineE2E) {
    fail('this test needs a build with the download hosts granted: `VEKTRA_E2E_FULL_ENGINE=1 npm run build`.');
  }
  if (!fullEngine && stamp.fullEngineE2E) {
    console.warn(
      'WARN dist was built with VEKTRA_E2E_FULL_ENGINE, which grants extra host permissions. ' +
        'Rebuild with `npm run build` before loading it as your extension.',
    );
  }
}
