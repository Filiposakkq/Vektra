import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeFingerprint, diffFingerprintFiles } from '../scripts/build-fingerprint.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway project folder holding `files` (path relative to it -> content). */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'vektra-fingerprint-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  return root;
}

function write(root: string, rel: string, content: string) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const SOURCES = {
  'src/content/index.ts': 'export {};',
  'src/analysis/deep/nested/config.ts': 'export const A = 1;',
  'public/fonts/OFL.txt': 'licence',
  'manifest.config.ts': 'export default {};',
  'package.json': '{}',
};

describe('build fingerprint', () => {
  it('ignores modification times', () => {
    const root = project(SOURCES);
    const before = computeFingerprint(root);
    utimesSync(join(root, 'src/content/index.ts'), new Date(2000, 0, 1), new Date(2000, 0, 1));
    expect(computeFingerprint(root)).toEqual(before);
  });

  it('does not depend on the order files were created in', () => {
    const reversed = Object.fromEntries(Object.entries(SOURCES).reverse());
    expect(computeFingerprint(project(reversed)).fingerprint).toBe(computeFingerprint(project(SOURCES)).fingerprint);
  });

  it('changes when a nested file is edited, added or removed, and names it', () => {
    const root = project(SOURCES);
    const base = computeFingerprint(root);

    write(root, 'src/analysis/deep/nested/config.ts', 'export const A = 2;');
    const edited = computeFingerprint(root);
    expect(edited.fingerprint).not.toBe(base.fingerprint);
    expect(diffFingerprintFiles(base.files, edited.files)).toEqual({
      added: [],
      removed: [],
      changed: ['src/analysis/deep/nested/config.ts'],
    });

    write(root, 'src/ui/new/panel.ts', 'export {};');
    unlinkSync(join(root, 'public/fonts/OFL.txt'));
    const moved = computeFingerprint(root);
    expect(diffFingerprintFiles(edited.files, moved.files)).toEqual({
      added: ['src/ui/new/panel.ts'],
      removed: ['public/fonts/OFL.txt'],
      changed: [],
    });
  });

  it('uses forward-slash paths relative to the project', () => {
    expect(Object.keys(computeFingerprint(project(SOURCES)).files)).toEqual([
      'manifest.config.ts',
      'package.json',
      'public/fonts/OFL.txt',
      'src/analysis/deep/nested/config.ts',
      'src/content/index.ts',
    ]);
  });

  it('never reads build output, generated engine files or other excluded paths', () => {
    const root = project(SOURCES);
    const base = computeFingerprint(root);
    write(root, 'dist/vektra-build.json', '{"fingerprint":"x"}');
    write(root, 'dist/assets/index.js', 'built');
    write(root, 'public/engine/stockfish.wasm', 'generated');
    write(root, 'public/engine/nested/more.js', 'generated');
    write(root, 'node_modules/stockfish/package.json', '{}');
    write(root, 'src/.DS_Store', 'clutter');
    write(root, 'README.md', 'not a build input');
    expect(computeFingerprint(root)).toEqual(base);
  });

  it('excludes a configured output folder even inside an input folder', () => {
    const root = project(SOURCES);
    const base = computeFingerprint(root, { exclude: ['src/out/'] });
    write(root, 'src/out/vektra-build.json', '{}');
    write(root, 'src/out/deep/chunk.js', 'built');
    expect(computeFingerprint(root, { exclude: ['src/out/'] })).toEqual(base);
    // Only whole path segments are excluded: src/outline.ts is still an input.
    write(root, 'src/outline.ts', 'export {};');
    expect(computeFingerprint(root, { exclude: ['src/out'] }).files).toHaveProperty(['src/outline.ts']);
  });
});
