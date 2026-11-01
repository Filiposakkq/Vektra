import type { Category } from '@core/analysis/classify';
import { categoryIconGroup } from '@core/draw/categoryIcons';
import type { Arrow } from '@core/hints/types';
import { drawArrows, type ArrowDrawing, type TextBox } from '@core/draw/arrowDrawing';

export type { Arrow } from '@core/hints/types';
import { BOARD_COLORS, DEFAULT_ARROW_COLORS, squareCenter, svgPath } from '@core/hints/arrowShapes';

export {
  ARROW_STYLES,
  BOARD_COLORS,
  DEFAULT_ARROW_COLORS,
  WEAKER_ARROW_COLOR,
  THREAT_ARROW_COLOR,
  labelTextColor,
  FADE_FULL_WIN_LOSS,
  lossFade,
  squareCenter,
  arrowGeometry,
  THREAT_OFFSET,
  segmentsOverlap,
  knightCorner,
  type ArrowGeometry,
} from '@core/hints/arrowShapes';

/**
 * SVG layer drawn inside the board element so it always covers the board
 * exactly, through resizes and layout changes. Flip is handled when drawing.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const OVERLAY_CLASS = 'vektra-overlay';


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

/** A text centred in a box, in the arrows' label font. */
function boxText(box: { x: number; y: number; width: number; height: number; text: string; textColor: string }): SVGTextElement {
  const label = document.createElementNS(SVG_NS, 'text');
  for (const [k, v] of Object.entries({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    fill: box.textColor,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
  })) label.setAttribute(k, String(v));
  for (const [k, v] of Object.entries(LABEL_FONT)) label.setAttribute(k, String(v));
  label.textContent = box.text;
  return label;
}

/** The piece a promoting move promotes to, as a letter tile in the target square's top-left corner. */
function promotionMarker(tile: TextBox, piece: string): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('vektra-promotion-marker');
  g.dataset.piece = piece;
  const rect = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({ x: tile.x, y: tile.y, width: tile.width, height: tile.height, rx: tile.radius, fill: tile.fill, stroke: '#fff', 'stroke-width': 0.02 })) {
    rect.setAttribute(k, String(v));
  }
  g.append(rect, boxText(tile));
  return g;
}

/** A score pill in the bottom-right corner of the arrow's target square (placed by drawArrows). */
function scoreLabel(pill: TextBox & { opacity: number }): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('vektra-score-label');
  g.setAttribute('opacity', String(pill.opacity));
  const rect = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({
    x: pill.x,
    y: pill.y,
    width: pill.width,
    height: pill.height,
    rx: pill.radius,
    fill: pill.fill,
    stroke: BOARD_COLORS.ink,
    'stroke-opacity': 0.35,
    'stroke-width': 0.015,
  })) {
    rect.setAttribute(k, String(v));
  }
  g.append(rect, boxText(pill));
  return g;
}

/** The step number of a move in a line, where the arrow leaves its square. */
function stepMarker(step: NonNullable<ArrowDrawing['step']>): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('vektra-step-marker');
  const circle = document.createElementNS(SVG_NS, 'circle');
  for (const [k, v] of Object.entries({ cx: step.cx, cy: step.cy, r: step.radius, fill: step.fill, stroke: '#fff', 'stroke-width': 0.025 })) {
    circle.setAttribute(k, String(v));
  }
  const r = step.radius;
  g.append(circle, boxText({ x: step.cx - r, y: step.cy - r, width: 2 * r, height: 2 * r, text: step.text, textColor: step.textColor }));
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
    // Colours, shapes, strength and labels come from core (drawArrows); this draws them as SVG.
    const drawings = drawArrows(arrows, flipped, this.colors);
    for (const d of drawings) {
      const { move, rank, provisional, weaker, threat, step } = d.arrow;
      const g = document.createElementNS(SVG_NS, 'g');
      g.classList.add(threat ? 'vektra-threat' : 'vektra-move');
      g.dataset.move = move;
      g.dataset.rank = String(rank);
      if (weaker) g.dataset.weaker = 'true';
      if (step) g.dataset.step = String(step);
      g.setAttribute('opacity', String(d.opacity));
      if (provisional) g.dataset.provisional = 'true';
      if (d.tinted) {
        // Both squares get an even tint under the pieces, the target a bit more.
        const fromHighlight = squareTint(d.from, d.color, 0.38);
        fromHighlight.classList.add('vektra-square-highlight', 'vektra-square-highlight-from');
        fromHighlight.dataset.square = move.slice(0, 2);
        const toHighlight = squareTint(d.to, d.color, 0.5);
        toHighlight.classList.add('vektra-square-highlight', 'vektra-square-highlight-to');
        toHighlight.dataset.square = move.slice(2, 4);
        highlights.push(fromHighlight, toHighlight);
      }
      g.setAttribute('filter', `url(#${SHADOW_ID})`);
      const shaft = document.createElementNS(SVG_NS, 'path');
      shaft.classList.add('vektra-arrow-line');
      shaft.setAttribute('d', svgPath(d.shaft));
      shaft.setAttribute('fill', 'none');
      shaft.setAttribute('stroke', d.color);
      shaft.setAttribute('stroke-width', String(d.width));
      shaft.setAttribute('stroke-linecap', 'round');
      shaft.setAttribute('stroke-linejoin', 'round');
      // Dashed while the engine may still change its mind; solid once final.
      if (d.dash) shaft.setAttribute('stroke-dasharray', `${d.dash[0]} ${d.dash[1]}`);
      if (d.corner) shaft.classList.add('vektra-knight-leg');
      const head = document.createElementNS(SVG_NS, 'polygon');
      head.setAttribute('points', d.head.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' '));
      head.setAttribute('fill', d.color);
      head.setAttribute('stroke', d.color);
      head.setAttribute('stroke-width', String(d.width * 0.15));
      head.setAttribute('stroke-linejoin', 'round');
      head.dataset.move = move;
      head.dataset.rank = String(rank);
      g.append(shaft, head);
      if (d.step) g.appendChild(stepMarker(d.step));
      if (d.promotion) g.appendChild(promotionMarker(d.promotion, move[4]));
      const signature = [rank, flipped, provisional, d.opacity.toFixed(3), d.color].join('|');
      g.dataset.key = d.key;
      g.dataset.signature = signature;
      const previous = this.arrowNodes.get(d.key);
      if (previous?.dataset.signature === signature) {
        // Unchanged: keep it (moving it keeps the drawing order right).
        this.svg.appendChild(previous);
        nextNodes.set(d.key, previous);
      } else {
        this.svg.appendChild(g);
        // New arrows fade in; changed ones ease from their old strength.
        const startOpacity = previous ? Number(previous.getAttribute('opacity') ?? 1) : 0;
        if (motion) g.animate?.([{ opacity: startOpacity }, { opacity: d.opacity }], { duration: 160, easing: 'ease-out' });
        previous?.remove();
        nextNodes.set(d.key, g);
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
    for (const d of [...drawings].sort((a, b) => a.arrow.rank - b.arrow.rank)) {
      if (d.label) this.svg.appendChild(scoreLabel(d.label));
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
