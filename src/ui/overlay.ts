import type { Category } from '../analysis/classify';
import { categoryIconGroup } from './categoryStyle';

/**
 * SVG layer drawn inside the board element so it always covers the board
 * exactly, through resizes and layout changes. Flip is handled when drawing.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const OVERLAY_CLASS = 'vektra-overlay';

export interface Arrow {
  /** UCI move, e.g. "e2e4" or "e7e8q". */
  move: string;
  /** 0 = best. */
  rank: number;
  /** Deliberately weaker alternative selected for this position. */
  weaker?: boolean;
  /** Current best line while a strength-limited search is still running. */
  provisional?: boolean;
}

/** Connector colour and visibility by rank. Colours come from settings. */
export const ARROW_STYLES = [
  { width: 0.09, opacity: 0.92 },
  { width: 0.075, opacity: 0.76 },
  { width: 0.06, opacity: 0.62 },
] as const;

export const DEFAULT_ARROW_COLORS = ['#2fb35a', '#3b8fd9', '#e8a33a'] as const;
export const WEAKER_ARROW_COLOR = '#c65ad9';

/** Centre of a square in board units (0-8), as seen on screen. */
export function squareCenter(square: string, flipped: boolean): [number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return flipped ? [7 - file + 0.5, rank + 0.5] : [file + 0.5, 7 - rank + 0.5];
}

export interface ArrowGeometry {
  /** Path for the shaft, drawn as a stroke with a round tail. */
  shaft: string;
  /** Polygon points for the head: tip, one barb, the notch, the other barb. */
  head: string;
}

const fmt = ([x, y]: [number, number]) => `${x.toFixed(3)},${y.toFixed(3)}`;

/**
 * Shape of a move connector from one square centre to another (board units),
 * with an optional corner for knight moves.
 */
export function arrowGeometry(
  from: [number, number],
  to: [number, number],
  width: number,
  corner: [number, number] | null = null,
  startOffset = 0.28,
): ArrowGeometry {
  const unit = (a: [number, number], b: [number, number]): [number, number] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  };
  const firstEnd = corner ?? to;
  const u1 = unit(from, firstEnd);
  const start: [number, number] = [from[0] + u1[0] * startOffset, from[1] + u1[1] * startOffset];
  const lastStart = corner ?? start;
  const [ux, uy] = unit(lastStart, to);
  const [nx, ny] = [-uy, ux];
  const lastLen = Math.hypot(to[0] - lastStart[0], to[1] - lastStart[1]);
  const head = Math.min(width * 2.5, lastLen * 0.5);
  const headW = width * 2.7;
  const back: [number, number] = [to[0] - ux * head, to[1] - uy * head];
  const notch: [number, number] = [to[0] - ux * head * 0.72, to[1] - uy * head * 0.72];
  const barbA: [number, number] = [back[0] + (nx * headW) / 2, back[1] + (ny * headW) / 2];
  const barbB: [number, number] = [back[0] - (nx * headW) / 2, back[1] - (ny * headW) / 2];
  const shaft = [start, ...(corner ? [corner] : []), notch].map((pt, i) => `${i ? 'L' : 'M'}${fmt(pt)}`).join(' ');
  return { shaft, head: [to, barbA, notch, barbB].map(fmt).join(' ') };
}

/** A knight move's corner: along the long leg first, then the short one. */
export function knightCorner(from: [number, number], to: [number, number]): [number, number] | null {
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  if (!((dx === 1 && dy === 2) || (dx === 2 && dy === 1))) return null;
  return dx > dy ? [to[0], from[1]] : [from[0], to[1]];
}

export interface SquareBadge {
  square: string;
  category: Category;
  title?: string;
}

const SHADOW_ID = 'vektra-arrow-shadow';

export class BoardOverlay {
  private lastBadge = '';
  private svg: SVGSVGElement;
  /** Colour per rank (best first). */
  colors: readonly string[] = DEFAULT_ARROW_COLORS;

  constructor(private board: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add(OVERLAY_CLASS);
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.svg.setAttribute('aria-hidden', 'true');
    Object.assign(this.svg.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '50',
    });
  }

  /** Re-attach if chess.com replaced the board or removed the layer. */
  private attach(board: HTMLElement) {
    this.board = board;
    if (this.svg.parentElement !== board) {
      if (getComputedStyle(board).position === 'static') board.style.position = 'relative';
      board.appendChild(this.svg);
    }
  }

  draw(board: HTMLElement, arrows: Arrow[], flipped: boolean): void {
    this.attach(board);
    this.svg.replaceChildren();
    this.svg.appendChild(this.shadowFilter());
    // Draw worst first so the best arrow ends up on top.
    for (const { move, rank, provisional, weaker } of [...arrows].sort((a, b) => b.rank - a.rank)) {
      const r = Math.min(rank, ARROW_STYLES.length - 1);
      const style = {
        ...ARROW_STYLES[r],
        color: weaker ? WEAKER_ARROW_COLOR : this.colors[r] ?? DEFAULT_ARROW_COLORS[r],
      };
      const from = squareCenter(move.slice(0, 2), flipped);
      const to = squareCenter(move.slice(2, 4), flipped);
      if (from[0] === to[0] && from[1] === to[1]) continue;
      const corner = knightCorner(from, to);
      const shape = arrowGeometry(from, to, style.width, corner, 0.42);

      const g = document.createElementNS(SVG_NS, 'g');
      g.classList.add('vektra-move');
      g.dataset.move = move;
      g.dataset.rank = String(rank);
      if (weaker) g.dataset.weaker = 'true';
      g.setAttribute(
        'opacity',
        String(style.opacity * (provisional ? 0.6 : 1) * (weaker ? 0.62 : 1)),
      );
      if (provisional) g.dataset.provisional = 'true';
      if (rank === 0) {
        for (const [square, center, role] of [
          [move.slice(0, 2), from, 'from'],
          [move.slice(2, 4), to, 'to'],
        ] as const) {
          const highlight = document.createElementNS(SVG_NS, 'rect');
          highlight.classList.add('vektra-square-highlight', `vektra-square-highlight-${role}`);
          highlight.dataset.square = square;
          highlight.setAttribute('x', String(center[0] - 0.5));
          highlight.setAttribute('y', String(center[1] - 0.5));
          highlight.setAttribute('width', '1');
          highlight.setAttribute('height', '1');
          highlight.setAttribute('fill', style.color);
          highlight.setAttribute('fill-opacity', '0.18');
          highlight.setAttribute('stroke', style.color);
          highlight.setAttribute('stroke-opacity', '0.6');
          highlight.setAttribute('stroke-width', '0.025');
          g.appendChild(highlight);
        }
      }
      g.setAttribute('filter', `url(#${SHADOW_ID})`);
      const shaft = document.createElementNS(SVG_NS, 'path');
      shaft.classList.add('vektra-arrow-line');
      shaft.setAttribute('d', shape.shaft);
      shaft.setAttribute('fill', 'none');
      shaft.setAttribute('stroke', style.color);
      shaft.setAttribute('stroke-width', String(style.width));
      shaft.setAttribute('stroke-linecap', 'round');
      shaft.setAttribute('stroke-linejoin', 'round');
      shaft.setAttribute('stroke-dasharray', '0.07 0.09');
      if (corner) shaft.classList.add('vektra-knight-leg');
      const head = document.createElementNS(SVG_NS, 'polygon');
      head.setAttribute('points', shape.head);
      head.setAttribute('fill', style.color);
      head.setAttribute('stroke', style.color);
      head.setAttribute('stroke-width', String(style.width * 0.15));
      head.setAttribute('stroke-linejoin', 'round');
      head.dataset.move = move;
      head.dataset.rank = String(rank);
      g.append(shaft, head);
      this.svg.appendChild(g);
    }
  }

  /** A soft shadow under the arrows so they stand out on light and dark squares. */
  private shadowFilter(): SVGDefsElement {
    const defs = document.createElementNS(SVG_NS, 'defs');
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = SHADOW_ID;
    for (const [k, v] of Object.entries({ x: '-20%', y: '-20%', width: '140%', height: '140%' })) filter.setAttribute(k, v);
    const shadow = document.createElementNS(SVG_NS, 'feDropShadow');
    for (const [k, v] of Object.entries({ dx: '0', dy: '0.025', stdDeviation: '0.025', 'flood-color': '#000', 'flood-opacity': '0.35' })) {
      shadow.setAttribute(k, v);
    }
    filter.appendChild(shadow);
    defs.appendChild(filter);
    return defs;
  }

  /** A small round icon in the top-right corner of a square. */
  drawBadge(board: HTMLElement, badge: SquareBadge, flipped: boolean): void {
    this.attach(board);
    const [cx, cy] = squareCenter(badge.square, flipped);
    // In the square's top-right corner, overlapping the edge like chess.com's.
    const size = 0.44;
    const holder = document.createElementNS(SVG_NS, 'svg');
    holder.classList.add('vektra-square-badge');
    holder.dataset.square = badge.square;
    holder.setAttribute('x', String(cx + 0.5 - size * 0.75));
    holder.setAttribute('y', String(cy - 0.5 - size * 0.25));
    holder.setAttribute('width', String(size));
    holder.setAttribute('height', String(size));
    holder.setAttribute('viewBox', '0 0 20 20');
    holder.setAttribute('overflow', 'visible');
    holder.setAttribute('role', 'img');
    if (badge.title) {
      holder.setAttribute('aria-label', badge.title);
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = badge.title;
      holder.appendChild(title);
    }
    const icon = categoryIconGroup(badge.category, true);
    // A short pop when it first appears, unless the user prefers less motion.
    // Redraws of the same badge (every engine update) don't pop again.
    const key = `${badge.square}:${badge.category}`;
    const isNew = key !== this.lastBadge;
    this.lastBadge = key;
    if (isNew && typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      icon.style.transformOrigin = '10px 10px';
      icon.animate?.(
        [
          { transform: 'scale(0.4)', opacity: 0 },
          { transform: 'scale(1.08)', opacity: 1, offset: 0.7 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: 180, easing: 'ease-out' },
      );
    }
    holder.appendChild(icon);
    this.svg.appendChild(holder);
  }


  clear(): void {
    this.svg.replaceChildren();
  }

  destroy(): void {
    this.svg.remove();
  }
}
