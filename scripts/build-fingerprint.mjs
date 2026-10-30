// Fingerprint of everything a production build reads, so the e2e tests can
// tell whether dist/ was built from the current sources. Only file paths and
// contents count; modification times are ignored.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** File the build writes into dist/ with the fingerprint it was built from. */
export const BUILD_STAMP_FILE = 'vektra-build.json';

/** Files and folders, relative to the project root, that the build reads. */
export const FINGERPRINT_INPUTS = [
  'src',
  'public',
  'manifest.config.ts',
  'vite.config.ts',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
  'scripts/copy-engine.mjs',
];

/**
 * Paths that are never inputs, at any depth below an input folder. dist is
 * the build output (it holds the stamp itself); public/engine is copied from
 * node_modules by scripts/copy-engine.mjs, and package-lock.json already
 * pins the version it comes from.
 */
export const FINGERPRINT_EXCLUDES = ['dist', 'node_modules', 'public/engine'];

/** Operating-system clutter that is not part of the sources. */
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const toPosix = (path) => path.split(sep).join('/');
const trimSlashes = (path) => toPosix(path).replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');

/**
 * Hash the build inputs under `root`. `exclude` adds paths (relative to root)
 * to FINGERPRINT_EXCLUDES, e.g. a different build output folder. Symbolic
 * links are skipped, so a link can't pull outside files in or loop.
 */
export function computeFingerprint(root, { inputs = FINGERPRINT_INPUTS, exclude = [] } = {}) {
  const excluded = [...FINGERPRINT_EXCLUDES, ...exclude].map(trimSlashes).filter(Boolean);
  const isExcluded = (rel) =>
    rel === '' ||
    rel === '..' ||
    rel.startsWith('../') ||
    excluded.some((path) => rel === path || rel.startsWith(`${path}/`)) ||
    rel.split('/').some((name) => IGNORED_NAMES.has(name));

  const found = new Map();
  const visit = (abs) => {
    const rel = toPosix(relative(root, abs));
    if (isExcluded(rel)) return;
    const stat = lstatSync(abs);
    if (stat.isDirectory()) {
      for (const name of readdirSync(abs)) visit(join(abs, name));
    } else if (stat.isFile()) {
      found.set(rel, createHash('sha256').update(readFileSync(abs)).digest('hex'));
    }
  };
  for (const input of inputs) {
    const abs = join(root, input);
    if (existsSync(abs)) visit(abs);
  }

  const files = {};
  const hash = createHash('sha256');
  for (const rel of [...found.keys()].sort()) {
    files[rel] = found.get(rel);
    hash.update(`${rel}\0${files[rel]}\n`);
  }
  return { fingerprint: hash.digest('hex'), files };
}

/** Files added, removed or changed between two `files` maps from computeFingerprint. */
export function diffFingerprintFiles(built, current) {
  const added = Object.keys(current).filter((rel) => !(rel in built)).sort();
  const removed = Object.keys(built).filter((rel) => !(rel in current)).sort();
  const changed = Object.keys(current).filter((rel) => rel in built && built[rel] !== current[rel]).sort();
  return { added, removed, changed };
}
