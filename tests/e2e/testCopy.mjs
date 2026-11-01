import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A copy of the built extension for the browser tests, without the manifest
 * key. The key fixes Vektra's extension ID, and an updater helper installed on
 * this machine accepts that ID: the tests would find it, and could have it
 * install a release over the real Vektra folder. Without the key the copy gets
 * another ID, which the helper refuses. The copy is removed when the process
 * exits.
 */
export function testCopy(dist) {
  const copy = mkdtempSync(join(tmpdir(), 'vektra-dist-'));
  cpSync(dist, copy, { recursive: true });
  const manifestFile = join(copy, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  delete manifest.key;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  process.on('exit', () => rmSync(copy, { recursive: true, force: true, maxRetries: 3 }));
  return copy;
}
