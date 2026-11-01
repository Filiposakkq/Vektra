import type { Category } from '../analysis/classify';
import { CATEGORY_STYLE } from '../analysis/categoryStyle';

/**
 * SVG and HTML badges for move categories, drawn with the standard DOM (the
 * extension and the Android overlay page both have it). Colours and symbols
 * are in analysis/categoryStyle.ts.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Categories light enough that a dark glyph reads better than a white one. */
const DARK_GLYPH: Partial<Record<Category, string>> = { inaccuracy: '#4a3500' };

/** A colour darkened by a fraction (0-1), for the tile's lower lip. */
function darken(hex: string, amount: number): string {
  const channel = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount));
  return `#${[1, 3, 5].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`;
}

/*
 * Glyphs are drawn as shapes rather than text, so they stay crisp and evenly
 * weighted down to the 15 px move-list size. All sit on a 20 × 20 grid,
 * centred on the tile's face (slightly above the middle, over the lip).
 */

function stroked(d: string, color: string, width = 2.7): SVGPathElement {
  return svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
}

/** "!" with its bar centred on x. */
function exclamation(x: number, color: string, width = 2.8): SVGGElement {
  const g = svgEl('g', {});
  g.append(stroked(`M${x} 4.7V10.1`, color, width), svgEl('circle', { cx: x, cy: 13.7, r: width * 0.56, fill: color }));
  return g;
}

/** "?" centred on x, scaled about its centre. */
function question(x: number, color: string, scale = 1): SVGGElement {
  const g = svgEl('g', { transform: `translate(${x} 9.2) scale(${scale}) translate(-10 -9.2)` });
  g.append(
    stroked('M7 7.1C7 5.3 8.3 4.3 10 4.3S13 5.3 13 6.9C13 8.9 10.1 9 10.1 10.6', color, 2.6),
    svgEl('circle', { cx: 10.1, cy: 13.7, r: 1.5, fill: color }),
  );
  return g;
}

function glyph(category: Category): SVGElement {
  const color = DARK_GLYPH[category] ?? '#fff';
  switch (category) {
    case 'brilliant': {
      const g = svgEl('g', {});
      g.append(exclamation(7.4, color, 2.6), exclamation(12.6, color, 2.6));
      return g;
    }
    case 'great':
      return exclamation(10, color, 3);
    case 'best':
      return svgEl('path', {
        d: 'M10 3.5l1.95 4.05 4.45.6-3.25 3.1.8 4.4L10 13.5l-3.95 2.15.8-4.4-3.25-3.1 4.45-.6z',
        fill: color,
        stroke: color,
        'stroke-width': 0.7,
        'stroke-linejoin': 'round',
      });
    case 'excellent':
      // Thumbs up: cuff on the left, hand with the thumb raised.
      return svgEl('path', {
        d: 'M4.4 8.6h2.5v6.6H4.4z M7.9 15.2V8.8l2.8-4.3c.55-.85 2-.5 1.9.6l-.4 2.8h2.8c1 0 1.7.95 1.45 1.9l-1.15 4.35c-.2.65-.8 1.05-1.45 1.05z',
        fill: color,
      });
    case 'good':
      return stroked('M5.6 9.7l2.9 2.9 5.9-6.2', color, 2.9);
    case 'book':
      // An open book: two pages meeting at the spine.
      return svgEl('path', {
        d: 'M4.2 5.9c2.1-.65 3.95-.3 5.25.95v7.75c-1.45-1.05-3.3-1.35-5.25-.85z M15.8 5.9c-2.1-.65-3.95-.3-5.25.95v7.75c1.45-1.05 3.3-1.35 5.25-.85z',
        fill: color,
      });
    case 'inaccuracy': {
      const g = svgEl('g', {});
      g.append(question(7.6, color, 0.86), exclamation(13.9, color, 2.4));
      return g;
    }
    case 'mistake':
      return question(10, color);
    case 'miss':
      return stroked('M6.5 5.6l7 7M13.5 5.6l-7 7', color, 2.9);
    case 'blunder': {
      const g = svgEl('g', {});
      g.append(question(6.6, color, 0.82), question(13.4, color, 0.82));
      return g;
    }
  }
}

/**
 * The category icon: a rounded tile in the category's colour with a darker
 * lower lip, like a key cap, and a drawn glyph. The colours keep the meanings
 * players know from Game Review; the tile is Vektra's own. Returned as a
 * 20 × 20 group for placing inside any SVG; `outline` adds the white rim used
 * on the board.
 */
export function categoryIconGroup(category: Category, outline = false): SVGGElement {
  const { color } = CATEGORY_STYLE[category];
  const g = svgEl('g', {});
  g.dataset.category = category;
  const rim: Record<string, string | number> = outline ? { stroke: '#fff', 'stroke-width': 1.5 } : {};
  g.append(
    svgEl('rect', { x: 1, y: 1, width: 18, height: 18, rx: 5, fill: darken(color, 0.28), ...rim }),
    svgEl('rect', { x: 1, y: 1, width: 18, height: 16.4, rx: 5, fill: color }),
    glyph(category),
  );
  return g;
}

/** A category icon as an inline element, for lists and the panel. */
export function categoryBadge(category: Category, size = 14): HTMLSpanElement {
  const wrap = document.createElement('span');
  Object.assign(wrap.style, {
    display: 'inline-flex',
    width: `${size}px`,
    height: `${size}px`,
    flex: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  const svg = svgEl('svg', { viewBox: '0 0 20 20', width: size, height: size, 'aria-hidden': 'true' });
  svg.style.display = 'block';
  svg.style.overflow = 'visible';
  svg.append(categoryIconGroup(category));
  wrap.append(svg);
  return wrap;
}
