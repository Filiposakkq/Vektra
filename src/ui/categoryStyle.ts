import type { Category } from '../analysis/classify';
import { CATEGORY_STYLE } from '../shared/categoryStyle';

/** SVG and HTML badges for move categories; colours and symbols are in shared/categoryStyle.ts. */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** White glyph for a category, drawn on a 20 × 20 grid centred on (10, 10). */
function glyph(category: Category): SVGElement {
  const white = '#fff';
  const stroke = (d: string) =>
    svgEl('path', { d, fill: 'none', stroke: white, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const text = (t: string, size: number) => {
    const e = svgEl('text', {
      x: 10,
      y: 10.6,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif',
      'font-weight': 800,
      'font-size': size,
      'letter-spacing': -0.6,
      fill: white,
    });
    e.textContent = t;
    return e;
  };
  switch (category) {
    case 'best':
      return svgEl('path', {
        d: 'M10 3.6l1.9 4.1 4.4.5-3.3 3 .9 4.4-3.9-2.2-3.9 2.2.9-4.4-3.3-3 4.4-.5z',
        fill: white,
        stroke: white,
        'stroke-width': 0.6,
        'stroke-linejoin': 'round',
      });
    case 'excellent':
      // Thumbs up: cuff on the left, hand with the thumb raised.
      return svgEl('path', {
        d: 'M4.6 9h2.4v6.4H4.6z M8 15.4V9.2l2.7-4.1c.5-.8 1.9-.5 1.8.6l-.4 2.7h2.7c1 0 1.6.9 1.4 1.8l-1.1 4.2c-.2.6-.8 1-1.4 1z',
        fill: white,
      });
    case 'good':
      return stroke('M5.8 10.4l2.9 2.9 5.6-6');
    case 'miss':
      return stroke('M6.8 6.8l6.4 6.4M13.2 6.8l-6.4 6.4');
    case 'book':
      // An open book: two pages meeting at the spine.
      return svgEl('path', {
        d: 'M4.4 6.4c2-.6 3.8-.3 5.1.9v7.4c-1.4-1-3.2-1.3-5.1-.8z M15.6 6.4c-2-.6-3.8-.3-5.1.9v7.4c1.4-1 3.2-1.3 5.1-.8z',
        fill: white,
      });
    case 'brilliant':
      return text('!!', 10.5);
    case 'great':
      return text('!', 12);
    case 'inaccuracy':
      return text('?!', 10.5);
    case 'mistake':
      return text('?', 12);
    case 'blunder':
      return text('??', 10.5);
  }
}

/**
 * The round category icon in chess.com's style: a coloured disc with a
 * slightly darker lower edge and a white glyph. Returned as a 20 × 20 group
 * for placing inside any SVG; `outline` adds the white ring used on the board.
 */
export function categoryIconGroup(category: Category, outline = false): SVGGElement {
  const { color } = CATEGORY_STYLE[category];
  const g = svgEl('g', {});
  g.append(
    svgEl('circle', { cx: 10, cy: 10.7, r: 9.3, fill: '#000', 'fill-opacity': 0.28 }),
    svgEl('circle', { cx: 10, cy: 10, r: 9.3, fill: color, ...(outline ? { stroke: '#fff', 'stroke-width': 1.2 } : {}) }),
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
