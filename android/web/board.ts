import { winPercent } from '@core/analysis/winProbability';
import type { Score } from '@core/engine/uci';
import {
  ARROW_STYLES,
  BOARD_COLORS,
  DEFAULT_ARROW_COLORS,
  THREAT_ARROW_COLOR,
  THREAT_OFFSET,
  WEAKER_ARROW_COLOR,
  arrowGeometry,
  knightCorner,
  labelTextColor,
  lossFade,
  segmentsOverlap,
  squareCenter,
} from '@core/hints/arrowShapes';
import type { Arrow } from '@core/hints/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * Draws hint arrows and the eval strip over the Chess.com app's board, with
 * the extension's shapes and colours (core/hints/arrowShapes.ts). The layer
 * sits above the app's pieces, so square tints stay light.
 */
export class BoardLayer {
  constructor(
    private readonly svg: SVGSVGElement,
    private readonly evalStrip: HTMLElement,
  ) {}

  clear(): void {
    this.svg.replaceChildren();
    this.evalStrip.classList.remove('shown');
  }

  draw(arrows: Arrow[], flipped: boolean): void {
    const tints: SVGElement[] = [];
    const shapes: SVGElement[] = [];
    const labels: SVGElement[] = [];
    const moveSegments = arrows
      .filter((a) => !a.threat)
      .map((a): [[number, number], [number, number]] => [squareCenter(a.move.slice(0, 2), flipped), squareCenter(a.move.slice(2, 4), flipped)]);
    // Threats underneath; then worst first so the best arrow ends up on top.
    const order = (a: Arrow) => (a.threat ? Infinity : a.rank);
    for (const arrow of [...arrows].sort((a, b) => order(b) - order(a))) {
      const r = Math.min(arrow.rank, ARROW_STYLES.length - 1);
      const color = arrow.threat ? THREAT_ARROW_COLOR : arrow.weaker ? WEAKER_ARROW_COLOR : DEFAULT_ARROW_COLORS[r];
      const style = arrow.threat ? ARROW_STYLES[2] : ARROW_STYLES[r];
      let from = squareCenter(arrow.move.slice(0, 2), flipped);
      let to = squareCenter(arrow.move.slice(2, 4), flipped);
      let corner = knightCorner(from, to);
      if (arrow.threat && moveSegments.some((segment) => segmentsOverlap([from, to], segment))) {
        const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const shift: [number, number] = [(-(to[1] - from[1]) / len) * THREAT_OFFSET, ((to[0] - from[0]) / len) * THREAT_OFFSET];
        const moved = (p: [number, number]): [number, number] => [p[0] + shift[0], p[1] + shift[1]];
        from = moved(from);
        to = moved(to);
        if (corner) corner = moved(corner);
      }
      const opacity =
        style.opacity * (arrow.provisional ? 0.6 : 1) * (arrow.weaker ? 0.62 : 1) * lossFade(arrow.winLoss, arrow.fadeFullAt);
      if (arrow.rank === 0 && !arrow.threat) {
        for (const [square, alpha] of [[from, 0.2], [to, 0.28]] as const) {
          tints.push(el('rect', { x: square[0] - 0.5, y: square[1] - 0.5, width: 1, height: 1, fill: color, 'fill-opacity': alpha }));
        }
      }
      const shape = arrowGeometry(from, to, style.width, corner, 0.42);
      const g = el('g', { opacity, filter: 'url(#vektra-shadow)' });
      const shaft = el('path', {
        d: shape.shaft,
        fill: 'none',
        stroke: color,
        'stroke-width': style.width,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      });
      // Dashed while the engine may still change its mind; solid once final.
      if (arrow.provisional) shaft.setAttribute('stroke-dasharray', `${style.width * 0.9} ${style.width * 1.1}`);
      g.append(shaft, el('polygon', { points: shape.head, fill: color, stroke: color, 'stroke-width': style.width * 0.15, 'stroke-linejoin': 'round' }));
      shapes.push(g);
      if (arrow.label) labels.push(this.scoreLabel(arrow.label, to, color, Math.max(opacity, 0.85)));
    }
    this.svg.replaceChildren(this.shadowFilter(), ...tints, ...shapes, ...labels);
  }

  /** The eval strip above the board: the user's share of the win chance on the left. */
  eval(whiteScore: Score, flipped: boolean): void {
    const white = winPercent(whiteScore);
    const mine = flipped ? 100 - white : white;
    const [own, other] = flipped ? ['#1b1b1b', '#f4f1ea'] : ['#f4f1ea', '#1b1b1b'];
    const mineBar = this.evalStrip.querySelector<HTMLElement>('#eval-mine')!;
    const theirsBar = this.evalStrip.querySelector<HTMLElement>('#eval-theirs')!;
    Object.assign(mineBar.style, { flexGrow: String(mine), background: own });
    Object.assign(theirsBar.style, { flexGrow: String(100 - mine), background: other });
    this.evalStrip.classList.add('shown');
  }

  /** A score pill in the bottom-right corner of the arrow's target square. */
  private scoreLabel(text: string, to: [number, number], color: string, opacity: number): SVGElement {
    const height = 0.24;
    const width = 0.1 + text.length * 0.105;
    const x = to[0] + 0.5 - width - 0.03;
    const y = to[1] + 0.5 - height - 0.03;
    const g = el('g', { opacity });
    const label = el('text', {
      x: x + width / 2,
      y: y + height / 2,
      fill: labelTextColor(color),
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 0.2,
      'font-weight': 700,
      'font-family': 'system-ui, sans-serif',
    });
    label.textContent = text;
    g.append(el('rect', { x, y, width, height, rx: height / 2, fill: color, stroke: BOARD_COLORS.ink, 'stroke-opacity': 0.35, 'stroke-width': 0.015 }), label);
    return g;
  }

  /** A tight dark edge under the arrows so they read on light squares and white pieces. */
  private shadowFilter(): SVGElement {
    const defs = el('defs', {});
    const filter = el('filter', { id: 'vektra-shadow', x: '-20%', y: '-20%', width: '140%', height: '140%' });
    filter.append(el('feDropShadow', { dx: 0, dy: 0.012, stdDeviation: 0.016, 'flood-color': BOARD_COLORS.ink, 'flood-opacity': 0.55 }));
    defs.append(filter);
    return defs;
  }
}
