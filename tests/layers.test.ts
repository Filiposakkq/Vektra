import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dependency direction. core/ is shared with the Android app, so it must not
 * depend on the extension at all, nor use chrome.* APIs. Inside the extension,
 * analysis/ must not depend on the page or its UI, and ui/ (overlays and
 * panels) must not depend on how the page is read. Content scripts are the
 * glue and may import from both.
 */
const FORBIDDEN: Record<string, string[]> = {
  core: ['analysis', 'background', 'content', 'engine', 'popup', 'shared', 'ui'],
  analysis: ['content', 'ui'],
  ui: ['content'],
};

const ROOT = resolve(import.meta.dirname, '..');
const CORE = join(ROOT, 'core');
const SRC = join(ROOT, 'extension/src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

/** Module paths imported (statically, dynamically or re-exported) by a source file. */
function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** "core", or the top-level folder under extension/src a file or import resolves to, if any. */
const layerOf = (path: string): string | undefined => {
  if (!relative(CORE, path).startsWith('..')) return 'core';
  const rel = relative(SRC, path);
  return rel.startsWith('..') ? undefined : rel.split(sep)[0];
};

/** Where an import points, for relative paths and the @core / @ext aliases. */
function target(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) return resolve(file, '..', specifier);
  if (specifier.startsWith('@core/')) return join(CORE, specifier.slice(6));
  if (specifier.startsWith('@ext/')) return join(SRC, specifier.slice(5));
  return undefined;
}

function violations(): string[] {
  const found: string[] = [];
  for (const file of [...sourceFiles(CORE), ...sourceFiles(SRC)]) {
    const from = layerOf(file)!;
    const forbidden = FORBIDDEN[from];
    if (!forbidden) continue;
    const name = relative(ROOT, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');
    for (const specifier of importsOf(source)) {
      const path = target(file, specifier);
      const to = path && layerOf(path);
      if (to && to !== from && forbidden.includes(to)) found.push(`${name} imports ${specifier}`);
    }
    if (from === 'core' && /\bchrome\./.test(source)) found.push(`${name} uses chrome.* APIs`);
  }
  return found;
}

describe('layers', () => {
  it('core/ stays free of the extension; analysis/ and ui/ keep their direction', () => {
    expect(violations()).toEqual([]);
  });

  it('finds every kind of import', () => {
    const source = [
      "import { a } from '../content/a';",
      "import type { B } from '../ui/b';",
      "export { c } from './c';",
      "import '../content/side-effect';",
      "const d = await import('../content/d');",
      'import {\n  e,\n  f,\n} from "../content/ef";',
    ].join('\n');
    expect(importsOf(source)).toEqual([
      '../content/a',
      '../ui/b',
      './c',
      '../content/ef',
      '../content/side-effect',
      '../content/d',
    ]);
  });
});
