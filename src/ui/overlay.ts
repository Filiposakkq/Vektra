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
  /** Drawn while the search is still running; the move may still change. */
  provisional?: boolean;
  /** Score printed at the arrow's target square, e.g. "+0.8" or "M3". */
  label?: string;
  /**
   * How much worse than the best move this alternative is, in win-chance
   * points (0-100). Worse alternatives are drawn fainter.
   */
  winLoss?: number;
  /** Position in one line of play (1 = the move now), drawn numbered in one colour. */
  step?: number;
  /** What the opponent would play if it were their move. */
  threat?: boolean;
}

/** Connector width and visibility by rank. */
export const ARROW_STYLES = [
  { width: 0.1, opacity: 0.95 },
  { width: 0.08, opacity: 0.82 },
  { width: 0.065, opacity: 0.7 },
] as const;

/**
 * Colours drawn on the board. They are picked to stay clear on chess.com's
 * green and cream squares and on its pieces: no green, which vanishes on the
 * dark squares, and a muted third choice so the first two lead.
 */
export const BOARD_COLORS = {
  /** The best move, and anything active. */
  lapis: '#2f6fe4',
  saffron: '#f2a516',
  slate: '#6f8196',
  /** A deliberately weaker move. */
  violet: '#9a5cf0',
  /** The opponent's threat. */
  vermilion: '#e5432f',
  /** Dark text on light fills, and arrow halos. */
  ink: '#14202c',
} as const;

export const DEFAULT_ARROW_COLORS = [BOARD_COLORS.lapis, BOARD_COLORS.saffron, BOARD_COLORS.slate] as const;
export const WEAKER_ARROW_COLOR = BOARD_COLORS.violet;
export const THREAT_ARROW_COLOR = BOARD_COLORS.vermilion;

/** Text colour that reads on a filled label of this colour. */
export function labelTextColor(fill: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? BOARD_COLORS.ink : '#fff';
}

/** Win-chance loss at which an alternative is drawn at its faintest. */
export const FADE_FULL_WIN_LOSS = 10;

/** Opacity factor for an alternative that loses this many win-chance points. */
export function lossFade(winLoss: number | undefined): number {
  if (!winLoss || winLoss <= 0) return 1;
  return 1 - 0.55 * Math.min(1, winLoss / FADE_FULL_WIN_LOSS);
}

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
const LABEL_FONT = {
  'font-size': 0.2,
  'font-weight': 700,
  'font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  'font-variant-numeric': 'tabular-nums',
};

/** Four corner brackets just inside a square, framing it without covering the piece. */
function squareCorners(center: [number, number], color: string, width = 0.055): SVGPathElement {
  const inset = 0.06;
  const arm = 0.24;
  const [l, t] = [center[0] - 0.5 + inset, center[1] - 0.5 + inset];
  const [r, b] = [center[0] + 0.5 - inset, center[1] + 0.5 - inset];
  const p = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const d = [
    `M${p(l, t + arm)} L${p(l, t)} L${p(l + arm, t)}`,
    `M${p(r - arm, t)} L${p(r, t)} L${p(r, t + arm)}`,
    `M${p(r, b - arm)} L${p(r, b)} L${p(r - arm, b)}`,
    `M${p(l + arm, b)} L${p(l, b)} L${p(l, b - arm)}`,
  ].join(' ');
  const path = document.createElementNS(SVG_NS, 'path');
  for (const [k, v] of Object.entries({
    d,
    fill: color,
    'fill-opacity': 0,
    stroke: color,
    'stroke-width': width,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  })) path.setAttribute(k, String(v));
  return path;
}

/** The piece a promoting move promotes to, as a letter tile in the target square's top-left corner. */
function promotionMarker(piece: string, to: [number, number], color: string): SVGGElement {
  const size = 0.3;
  const x = to[0] - 0.5 + 0.05;
  const y = to[1] - 0.5 + 0.05;
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('vektra-promotion-marker');
  g.dataset.piece = piece;
  const tile = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({ x, y, width: size, height: size, rx: 0.06, fill: color, stroke: '#fff', 'stroke-width': 0.02 })) {
    tile.setAttribute(k, String(v));
  }
  const label = document.createElementNS(SVG_NS, 'text');
  for (const [k, v] of Object.entries({
    x: x + size / 2,
    y: y + size / 2,
    fill: labelTextColor(color),
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
  })) label.setAttribute(k, String(v));
  for (const [k, v] of Object.entries(LABEL_FONT)) label.setAttribute(k, String(v));
  label.textContent = piece.toUpperCase();
  g.append(tile, label);
  return g;
}

/**
 * A score pill in the bottom-right corner of the arrow's target square. When
 * several arrows end on one square, later pills stack upwards (slot 1, 2...).
 */
function scoreLabel(text: string, to: [number, number], color: string, opacity: number, slot: number): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('vektra-score-label');
  g.setAttribute('opacity', String(opacity));
  const height = 0.24;
  const width = 0.1 + text.length * 0.105;
  const x = to[0] + 0.5 - width - 0.03;
  const y = to[1] + 0.5 - height - 0.03 - slot * (height + 0.03);
  const pill = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({
    x,
    y,
    width,
    height,
    rx: height / 2,
    fill: color,
    stroke: BOARD_COLORS.ink,
    'stroke-opacity': 0.35,
    'stroke-width': 0.015,
  })) {
    pill.setAttribute(k, String(v));
  }
  const label = document.createElementNS(SVG_NS, 'text');
  for (const [k, v] of Object.entries({
    x: x + width / 2,
    y: y + height / 2,
    fill: labelTextColor(color),
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
  })) label.setAttribute(k, String(v));
  for (const [k, v] of Object.entries(LABEL_FONT)) label.setAttribute(k, String(v));
  label.textContent = text;
  g.append(pill, label);
  return g;
}

/** The step number of a move in a line, where the arrow leaves its square. */
function stepMarker(step: number, from: [number, number], toward: [number, number], color: string): SVGGElement {
  const len = Math.hypot(toward[0] - from[0], toward[1] - from[1]) || 1;
  const cx = from[0] + ((toward[0] - from[0]) / len) * 0.42;
  const cy = from[1] + ((toward[1] - from[1]) / len) * 0.42;
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('vektra-step-marker');
  const circle = document.createElementNS(SVG_NS, 'circle');
  for (const [k, v] of Object.entries({ cx, cy, r: 0.13, fill: color, stroke: '#fff', 'stroke-width': 0.025 })) {
    circle.setAttribute(k, String(v));
  }
  const label = document.createElementNS(SVG_NS, 'text');
  for (const [k, v] of Object.entries({ x: cx, y: cy, fill: labelTextColor(color), 'text-anchor': 'middle', 'dominant-baseline': 'central' })) {
    label.setAttribute(k, String(v));
  }
  for (const [k, v] of Object.entries(LABEL_FONT)) label.setAttribute(k, String(v));
  label.textContent = String(step);
  g.append(circle, label);
  return g;
}

export class BoardOverlay {
  private lastBadge = '';
  private svg: SVGSVGElement;
  /** Colour per rank (best first). */
  colors: readonly string[] = DEFAULT_ARROW_COLORS;

  // The board is passed again on every draw, which attaches the layer to it.
  constructor(_board: HTMLElement) {
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
    if (this.svg.parentElement !== board) {
      if (getComputedStyle(board).position === 'static') board.style.position = 'relative';
      board.appendChild(this.svg);
    }
  }

  draw(board: HTMLElement, arrows: Arrow[], flipped: boolean): void {
    this.attach(board);
    this.svg.replaceChildren();
    this.svg.appendChild(this.shadowFilter());
    const labels: { rank: number; draw: (slot: number) => SVGGElement; square: string }[] = [];
    // Threats go underneath; then worst first so the best arrow ends up on top.
    const order = (a: Arrow) => (a.threat ? Infinity : a.rank);
    for (const arrow of [...arrows].sort((a, b) => order(b) - order(a))) {
      const { move, rank, provisional, weaker, threat, step } = arrow;
      const r = Math.min(rank, ARROW_STYLES.length - 1);
      // A numbered line keeps one colour; only its strength fades by step.
      const color = threat
        ? THREAT_ARROW_COLOR
        : weaker
          ? WEAKER_ARROW_COLOR
          : step
            ? this.colors[0] ?? DEFAULT_ARROW_COLORS[0]
            : this.colors[r] ?? DEFAULT_ARROW_COLORS[r];
      const style = { ...(threat ? ARROW_STYLES[2] : ARROW_STYLES[r]), color };
      const from = squareCenter(move.slice(0, 2), flipped);
      const to = squareCenter(move.slice(2, 4), flipped);
      if (from[0] === to[0] && from[1] === to[1]) continue;
      const corner = knightCorner(from, to);
      const shape = arrowGeometry(from, to, style.width, corner, 0.42);

      const g = document.createElementNS(SVG_NS, 'g');
      g.classList.add(threat ? 'vektra-threat' : 'vektra-move');
      g.dataset.move = move;
      g.dataset.rank = String(rank);
      if (weaker) g.dataset.weaker = 'true';
      if (step) g.dataset.step = String(step);
      const opacity =
        style.opacity * (provisional ? 0.6 : 1) * (weaker ? 0.62 : 1) * lossFade(arrow.winLoss);
      g.setAttribute('opacity', String(opacity));
      if (provisional) g.dataset.provisional = 'true';
      if (rank === 0 && !threat) {
        // The piece's square is tinted; the target square is framed in corners.
        const fromHighlight = document.createElementNS(SVG_NS, 'rect');
        fromHighlight.classList.add('vektra-square-highlight', 'vektra-square-highlight-from');
        fromHighlight.dataset.square = move.slice(0, 2);
        for (const [k, v] of Object.entries({
          x: from[0] - 0.5,
          y: from[1] - 0.5,
          width: 1,
          height: 1,
          fill: style.color,
          'fill-opacity': 0.2,
        })) fromHighlight.setAttribute(k, String(v));
        const toHighlight = squareCorners(to, style.color);
        toHighlight.classList.add('vektra-square-highlight', 'vektra-square-highlight-to');
        toHighlight.dataset.square = move.slice(2, 4);
        g.append(fromHighlight, toHighlight);
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
      // Dashed while the engine may still change its mind; solid once final.
      if (provisional) shaft.setAttribute('stroke-dasharray', `${style.width * 0.9} ${style.width * 1.1}`);
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
      if (step) g.appendChild(stepMarker(step, from, corner ?? to, style.color));
      if (move.length === 5 && !threat) g.appendChild(promotionMarker(move[4], to, style.color));
      this.svg.appendChild(g);
      const { label } = arrow;
      if (label) {
        labels.push({
          rank,
          square: move.slice(2, 4),
          draw: (slot) => scoreLabel(label, to, style.color, Math.max(opacity, 0.85), slot),
        });
      }
    }
    // Labels last, so no arrow covers a score; the best move's sits lowest.
    const slots = new Map<string, number>();
    for (const label of labels.sort((a, b) => a.rank - b.rank)) {
      const slot = slots.get(label.square) ?? 0;
      slots.set(label.square, slot + 1);
      this.svg.appendChild(label.draw(slot));
    }
  }

  /** Frame only the square of the piece to move (the first step of a hint). */
  drawPieceHint(board: HTMLElement, square: string, flipped: boolean): void {
    this.attach(board);
    const center = squareCenter(square, flipped);
    const color = this.colors[0] ?? DEFAULT_ARROW_COLORS[0];
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('vektra-piece-hint');
    g.dataset.square = square;
    const tint = document.createElementNS(SVG_NS, 'rect');
    for (const [k, v] of Object.entries({
      x: center[0] - 0.5,
      y: center[1] - 0.5,
      width: 1,
      height: 1,
      fill: color,
      'fill-opacity': 0.24,
    })) tint.setAttribute(k, String(v));
    g.append(tint, squareCorners(center, color, 0.07));
    g.setAttribute('filter', `url(#${SHADOW_ID})`);
    this.svg.appendChild(g);
  }

  /** A soft shadow under the arrows so they stand out on light and dark squares. */
  private shadowFilter(): SVGDefsElement {
    const defs = document.createElementNS(SVG_NS, 'defs');
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = SHADOW_ID;
    for (const [k, v] of Object.entries({ x: '-20%', y: '-20%', width: '140%', height: '140%' })) filter.setAttribute(k, v);
    const shadow = document.createElementNS(SVG_NS, 'feDropShadow');
    // A tight, dark edge rather than a soft shadow: it keeps light colours
    // readable on cream squares and white pieces.
    for (const [k, v] of Object.entries({ dx: '0', dy: '0.012', stdDeviation: '0.016', 'flood-color': BOARD_COLORS.ink, 'flood-opacity': '0.55' })) {
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
