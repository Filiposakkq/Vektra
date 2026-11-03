// Converts the cburnett piece SVGs (android/web/pieces) into Android vector
// drawables (android/app/src/main/res/drawable/piece_*.xml), so the app draws
// them natively. Run with `node scripts/pieces-to-android.mjs` after changing
// the SVGs. Handles what those files use: <g> with inherited presentation
// attributes, <path>, <circle>.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const source = resolve(repo, 'android/web/pieces');
const target = resolve(repo, 'android/app/src/main/res/drawable');

const INHERITED = ['fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'];

/** The attributes of a tag's text, as a map. */
function attributes(tag) {
  const map = {};
  for (const [, name, value] of tag.matchAll(/([\w-]+)="([^"]*)"/g)) map[name] = value;
  return map;
}

function color(value) {
  if (!value || value === 'none') return null;
  const hex = value.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return `#FF${full.toUpperCase()}`;
}

/** One <path> of a vector drawable from an SVG shape and its inherited style. */
function vectorPath(d, style) {
  const fill = color(style.fill ?? '#000');
  const stroke = color(style.stroke);
  const parts = [`android:pathData="${d}"`];
  if (fill) parts.push(`android:fillColor="${fill}"`);
  if (style['fill-rule'] === 'evenodd') parts.push('android:fillType="evenOdd"');
  if (stroke) {
    parts.push(`android:strokeColor="${stroke}"`, `android:strokeWidth="${style['stroke-width'] ?? 1}"`);
    parts.push(`android:strokeLineCap="${style['stroke-linecap'] ?? 'butt'}"`);
    parts.push(`android:strokeLineJoin="${style['stroke-linejoin'] ?? 'miter'}"`);
  }
  return `    <path ${parts.join('\n        ')} />`;
}

function convert(svg) {
  const out = [];
  const stack = [{}];
  for (const [, closing, name, rest] of svg.matchAll(/<(\/?)(\w+)([^>]*)>/g)) {
    if (closing) {
      if (name === 'g' || name === 'svg') stack.pop();
      continue;
    }
    const own = attributes(rest);
    const style = { ...stack[stack.length - 1] };
    for (const key of INHERITED) if (own[key] !== undefined) style[key] = own[key];
    const selfClosing = rest.trim().endsWith('/');
    if (name === 'g' || name === 'svg') {
      if (!selfClosing) stack.push(style);
    } else if (name === 'path') {
      out.push(vectorPath(own.d, style));
    } else if (name === 'circle') {
      const [cx, cy, r] = ['cx', 'cy', 'r'].map((k) => Number(own[k]));
      out.push(vectorPath(`M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0z`, style));
    }
  }
  return out.join('\n');
}

for (const file of readdirSync(source).filter((f) => f.endsWith('.svg'))) {
  const name = `piece_${file.replace('.svg', '').toLowerCase()}.xml`;
  const body = convert(readFileSync(resolve(source, file), 'utf8'));
  writeFileSync(
    resolve(target, name),
    `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<!-- The cburnett ${file.replace('.svg', '')} by Colin M.L. Burnett, GPLv2+ (android/web/pieces/README.md),\n` +
      `     converted from android/web/pieces/${file} by scripts/pieces-to-android.mjs. -->\n` +
      `<vector xmlns:android="http://schemas.android.com/apk/res/android"\n` +
      `    android:width="45dp" android:height="45dp" android:viewportWidth="45" android:viewportHeight="45">\n` +
      `${body}\n</vector>\n`,
  );
  console.log(name);
}
