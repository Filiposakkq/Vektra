import type { Category } from '@core/analysis/classify';
import { categoryIconGroup } from './categoryStyle';
import type { Arrow } from '@core/hints/types';

export type { Arrow } from '@core/hints/types';

/**
 * SVG layer drawn inside the board element so it always covers the board
 * exactly, through resizes and layout changes. Flip is handled when drawing.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const OVERLAY_CLASS = 'vektra-overlay';


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
export function lossFade(winLoss: number | undefined, fullAt = FADE_FULL_WIN_LOSS): number {
  if (!winLoss || winLoss <= 0) return 1;
  return 1 - 0.55 * Math.min(1, winLoss / Math.max(1, fullAt));
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

/** How far (board units) a threat arrow is moved aside when it would cover a move arrow. */
export const THREAT_OFFSET = 0.18;

/**
 * True if two straight segments lie along the same line and overlap, so one
 * arrow drawn over the other would hide it.
 */
export function segmentsOverlap(
  a: [[number, number], [number, number]],
  b: [[number, number], [number, number]],
): boolean {
  const [ax, ay] = [a[1][0] - a[0][0], a[1][1] - a[0][1]];
  const len = Math.hypot(ax, ay);
  if (len === 0) return false;
  const [ux, uy] = [ax / len, ay / len];
  const [bx, by] = [b[1][0] - b[0][0], b[1][1] - b[0][1]];
  const blen = Math.hypot(bx, by);
  if (blen === 0) return false;
  // Parallel (within about 12 degrees) and close to the same line.
  if (Math.abs(ux * by - uy * bx) / blen > 0.2) return false;
  const distance = Math.abs(ux * (b[0][1] - a[0][1]) - uy * (b[0][0] - a[0][0]));
  if (distance > 0.25) return false;
  // Overlapping along the line.
  const t0 = ux * (b[0][0] - a[0][0]) + uy * (b[0][1] - a[0][1]);
  const t1 = ux * (b[1][0] - a[0][0]) + uy * (b[1][1] - a[0][1]);
  return Math.max(Math.min(t0, t1), 0) < Math.min(Math.max(t0, t1), len) - 0.1;
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

/** Whether to animate, honouring the user's reduced-motion setting. */
function allowMotion(): boolean {
  return typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}
const LABEL_FONT = {
  'font-size': 0.2,
  'font-weight': 700,
  'font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  'font-variant-numeric': 'tabular-nums',
};

/** An even tint over a whole square, drawn under the pieces. */
function squareTint(center: [number, number], color: string, opacity: number): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({
    x: center[0] - 0.5,
    y: center[1] - 0.5,
    width: 1,
    height: 1,
    fill: color,
    'fill-opacity': opacity,
  })) rect.setAttribute(k, String(v));
  return rect;
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
  /** Square highlights, under the pieces like chess.com's own. */
  private under: SVGSVGElement;
  /** The arrow elements on the board, by arrow kind and move. */
  private arrowNodes = new Map<string, SVGGElement>();
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
    // No z-index: as the board's first child it sits below the pieces.
    this.under = document.createElementNS(SVG_NS, 'svg');
    this.under.classList.add('vektra-underlay');
    this.under.setAttribute('viewBox', '0 0 8 8');
    this.under.setAttribute('aria-hidden', 'true');
    Object.assign(this.under.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
  }

  /** Re-attach if chess.com replaced the board or removed the layer. */
  private attach(board: HTMLElement) {
    if (this.svg.parentElement !== board) {
      if (getComputedStyle(board).position === 'static') board.style.position = 'relative';
      board.appendChild(this.svg);
    }
    // chess.com can add elements first; the highlights must stay below the pieces.
    if (board.firstChild !== this.under) board.insertBefore(this.under, board.firstChild);
  }

  /**
   * Draw the arrows. The engine sends many updates while it searches, so
   * an arrow that hasn't changed keeps its element, and one that changed or
   * left fades instead of blinking. Labels and highlights outside the arrows
   * are redrawn each time.
   */
  draw(board: HTMLElement, arrows: Arrow[], flipped: boolean): void {
    this.attach(board);
    const motion = allowMotion();
    // Keep only the current arrows (and any still fading out until now).
    for (const child of [...this.svg.children]) {
      if (!(child instanceof SVGGElement && child.dataset.key && this.arrowNodes.get(child.dataset.key) === child)) {
        child.remove();
      }
    }
    this.svg.prepend(this.shadowFilter());
    const nextNodes = new Map<string, SVGGElement>();
    const highlights: SVGRectElement[] = [];
    const labels: { rank: number; draw: (slot: number) => SVGGElement; square: string }[] = [];
    // Threats go underneath; then worst first so the best arrow ends up on top.
    const order = (a: Arrow) => (a.threat ? Infinity : a.rank);
    const moveSegments = arrows
      .filter((a) => !a.threat)
      .map((a): [[number, number], [number, number]] => [
        squareCenter(a.move.slice(0, 2), flipped),
        squareCenter(a.move.slice(2, 4), flipped),
      ]);
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
      let from = squareCenter(move.slice(0, 2), flipped);
      let to = squareCenter(move.slice(2, 4), flipped);
      if (from[0] === to[0] && from[1] === to[1]) continue;
      let corner = knightCorner(from, to);
      // A threat along the same line as a move arrow would hide it (or be
      // hidden): move the threat a little to one side.
      if (threat && moveSegments.some((segment) => segmentsOverlap([from, to], segment))) {
        const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const shift: [number, number] = [(-(to[1] - from[1]) / len) * THREAT_OFFSET, ((to[0] - from[0]) / len) * THREAT_OFFSET];
        const moved = (p: [number, number]): [number, number] => [p[0] + shift[0], p[1] + shift[1]];
        from = moved(from);
        to = moved(to);
        if (corner) corner = moved(corner);
      }
      const shape = arrowGeometry(from, to, style.width, corner, 0.42);

      const g = document.createElementNS(SVG_NS, 'g');
      g.classList.add(threat ? 'vektra-threat' : 'vektra-move');
      g.dataset.move = move;
      g.dataset.rank = String(rank);
      if (weaker) g.dataset.weaker = 'true';
      if (step) g.dataset.step = String(step);
      const opacity =
        style.opacity * (provisional ? 0.6 : 1) * (weaker ? 0.62 : 1) * lossFade(arrow.winLoss, arrow.fadeFullAt);
      g.setAttribute('opacity', String(opacity));
      if (provisional) g.dataset.provisional = 'true';
      if (rank === 0 && !threat) {
        // Both squares get an even tint under the pieces, the target a bit more.
        const fromHighlight = squareTint(from, style.color, 0.38);
        fromHighlight.classList.add('vektra-square-highlight', 'vektra-square-highlight-from');
        fromHighlight.dataset.square = move.slice(0, 2);
        const toHighlight = squareTint(to, style.color, 0.5);
        toHighlight.classList.add('vektra-square-highlight', 'vektra-square-highlight-to');
        toHighlight.dataset.square = move.slice(2, 4);
        highlights.push(fromHighlight, toHighlight);
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
      const key = `${threat ? 'threat' : weaker ? 'weaker' : step ? `step${step}` : 'move'}:${move}`;
      const signature = [rank, flipped, provisional, opacity.toFixed(3), color].join('|');
      g.dataset.key = key;
      g.dataset.signature = signature;
      const previous = this.arrowNodes.get(key);
      if (previous?.dataset.signature === signature) {
        // Unchanged: keep it (moving it keeps the drawing order right).
        this.svg.appendChild(previous);
        nextNodes.set(key, previous);
      } else {
        this.svg.appendChild(g);
        // New arrows fade in; changed ones ease from their old strength.
        const startOpacity = previous ? Number(previous.getAttribute('opacity') ?? 1) : 0;
        if (motion) g.animate?.([{ opacity: startOpacity }, { opacity }], { duration: 160, easing: 'ease-out' });
        previous?.remove();
        nextNodes.set(key, g);
      }
      const { label } = arrow;
      if (label) {
        labels.push({
          rank,
          square: move.slice(2, 4),
          draw: (slot) => scoreLabel(label, to, style.color, Math.max(opacity, 0.85), slot),
        });
      }
    }
    // Arrows that are gone fade out, then leave; the next draw removes any left.
    for (const [key, old] of this.arrowNodes) {
      if (nextNodes.has(key)) continue;
      delete old.dataset.key;
      const fade = motion
        ? old.animate?.([{ opacity: Number(old.getAttribute('opacity') ?? 1) }, { opacity: 0 }], {
          duration: 140,
          easing: 'ease-in',
          fill: 'forwards',
        })
        : undefined;
      if (fade) fade.onfinish = () => old.remove();
      else old.remove();
    }
    this.arrowNodes = nextNodes;
    this.under.replaceChildren(...highlights);
    // Labels last, so no arrow covers a score; the best move's sits lowest.
    const slots = new Map<string, number>();
    for (const label of labels.sort((a, b) => a.rank - b.rank)) {
      const slot = slots.get(label.square) ?? 0;
      slots.set(label.square, slot + 1);
      this.svg.appendChild(label.draw(slot));
    }
  }

  /** Tint only the square of the piece to move (the first step of a hint). */
  drawPieceHint(board: HTMLElement, square: string, flipped: boolean): void {
    this.attach(board);
    const color = this.colors[0] ?? DEFAULT_ARROW_COLORS[0];
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('vektra-piece-hint');
    g.dataset.square = square;
    g.append(squareTint(squareCenter(square, flipped), color, 0.5));
    this.under.appendChild(g);
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
    this.under.replaceChildren();
    this.arrowNodes.clear();
  }

  destroy(): void {
    this.svg.remove();
    this.under.remove();
  }
}
