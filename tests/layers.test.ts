import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dependency direction between the folders under src/: analysis/ (game
 * evaluation) must not depend on the page or its UI, and ui/ (overlays and
 * panels) must not depend on how the page is read. Content scripts are the
 * glue and may import from both.
 */
const FORBIDDEN: Record<string, string[]> = {
  analysis: ['content', 'ui'],
  ui: ['content'],
};

const SRC = resolve(import.meta.dirname, '../src');

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

/** The top-level folder under src/ a file or import resolves to, if any. */
const layerOf = (path: string): string | undefined => {
  const rel = relative(SRC, path);
  return rel.startsWith('..') ? undefined : rel.split(sep)[0];
};

function violations(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const from = layerOf(file)!;
    const forbidden = FORBIDDEN[from];
    if (!forbidden) continue;
    for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue;
      const to = layerOf(resolve(file, '..', specifier));
      if (to && forbidden.includes(to)) found.push(`${relative(SRC, file).split(sep).join('/')} imports ${specifier}`);
    }
  }
  return found;
}

describe('layers', () => {
  it('analysis/ does not import content/ or ui/, and ui/ does not import content/', () => {
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
