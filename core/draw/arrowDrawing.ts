import {
  ARROW_STYLES,
  DEFAULT_ARROW_COLORS,
  THREAT_ARROW_COLOR,
  THREAT_OFFSET,
  WEAKER_ARROW_COLOR,
  arrowPoints,
  knightCorner,
  labelTextColor,
  lossFade,
  segmentsOverlap,
  squareCenter,
  type Point,
} from '../hints/arrowShapes';
import type { Arrow } from '../hints/types';

/**
 * Everything needed to draw hint arrows, worked out once for every platform:
 * the extension draws it as SVG inside the Chess.com page, the Android app
 * paints it natively. Change how arrows look here and both follow. All
 * positions are in board units (a square is 1 by 1, the board 8 by 8, seen
 * from the side the board is shown from).
 */

/** A filled box with text centred in it (score pills, promotion tiles). */
export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius. */
  radius: number;
  fill: string;
  text: string;
  textColor: string;
}

export interface ArrowDrawing {
  /** Stable for an arrow kind and move, so a platform can keep an unchanged arrow's element. */
  key: string;
  arrow: Arrow;
  color: string;
  /** Shaft width; the head is sized from it. */
  width: number;
  /** For the whole arrow: shaft, head and markers together. */
  opacity: number;
  /** Dash and gap lengths while the engine may still change its mind; null once final. */
  dash: [number, number] | null;
  from: Point;
  to: Point;
  /** A knight move's corner. */
  corner: Point | null;
  /** The shaft's line: start, knight corner, the notch in the head. */
  shaft: Point[];
  /** Tip, one barb, the notch, the other barb. */
  head: Point[];
  /** The best move: both its squares are tinted. */
  tinted: boolean;
  /** The score pill at the target square, drawn after every arrow so none covers it. */
  label: (TextBox & { opacity: number }) | null;
  /** The piece a promotion promotes to, in the target square's corner. */
  promotion: TextBox | null;
  /** The move's number in a line of play, where the arrow leaves its square. */
  step: { cx: number; cy: number; radius: number; fill: string; text: string; textColor: string } | null;
}

/** Score pill size: its height, and its width for a text of `length` characters. */
const LABEL_HEIGHT = 0.24;
const labelWidth = (length: number) => 0.1 + length * 0.105;

/**
 * The arrows in drawing order: threats first (underneath), then the worst
 * move first, so the best arrow ends up on top. `colors` are by rank.
 */
export function drawArrows(arrows: readonly Arrow[], flipped: boolean, colors: readonly string[] = DEFAULT_ARROW_COLORS): ArrowDrawing[] {
  const moveSegments = arrows
    .filter((a) => !a.threat)
    .map((a): [Point, Point] => [squareCenter(a.move.slice(0, 2), flipped), squareCenter(a.move.slice(2, 4), flipped)]);
  const order = (a: Arrow) => (a.threat ? Infinity : a.rank);
  const drawings: ArrowDrawing[] = [];
  for (const arrow of [...arrows].sort((a, b) => order(b) - order(a))) {
    const { move, rank, provisional, weaker, threat, step } = arrow;
    const r = Math.min(rank, ARROW_STYLES.length - 1);
    // A numbered line keeps one colour; only its strength fades by step.
    const color = threat
      ? THREAT_ARROW_COLOR
      : weaker
        ? WEAKER_ARROW_COLOR
        : step
          ? colors[0] ?? DEFAULT_ARROW_COLORS[0]
          : colors[r] ?? DEFAULT_ARROW_COLORS[r];
    const style = threat ? ARROW_STYLES[2] : ARROW_STYLES[r];
    let from = squareCenter(move.slice(0, 2), flipped);
    let to = squareCenter(move.slice(2, 4), flipped);
    if (from[0] === to[0] && from[1] === to[1]) continue;
    let corner = knightCorner(from, to);
    // A threat along the same line as a move arrow would hide it (or be
    // hidden): move the threat a little to one side.
    if (threat && moveSegments.some((segment) => segmentsOverlap([from, to], segment))) {
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const shift: Point = [(-(to[1] - from[1]) / len) * THREAT_OFFSET, ((to[0] - from[0]) / len) * THREAT_OFFSET];
      const moved = (p: Point): Point => [p[0] + shift[0], p[1] + shift[1]];
      from = moved(from);
      to = moved(to);
      if (corner) corner = moved(corner);
    }
    const opacity = style.opacity * (provisional ? 0.6 : 1) * (weaker ? 0.62 : 1) * lossFade(arrow.winLoss, arrow.fadeFullAt);
    const { shaft, head } = arrowPoints(from, to, style.width, corner, 0.42);
    const toward = corner ?? to;
    const len = Math.hypot(toward[0] - from[0], toward[1] - from[1]) || 1;
    drawings.push({
      key: `${threat ? 'threat' : weaker ? 'weaker' : step ? `step${step}` : 'move'}:${move}`,
      arrow,
      color,
      width: style.width,
      opacity,
      dash: provisional ? [style.width * 0.9, style.width * 1.1] : null,
      from,
      to,
      corner,
      shaft,
      head,
      tinted: rank === 0 && !threat,
      label: null,
      promotion:
        move.length === 5 && !threat
          ? {
              x: to[0] - 0.5 + 0.05,
              y: to[1] - 0.5 + 0.05,
              width: 0.3,
              height: 0.3,
              radius: 0.06,
              fill: color,
              text: move[4].toUpperCase(),
              textColor: labelTextColor(color),
            }
          : null,
      step: step
        ? {
            cx: from[0] + ((toward[0] - from[0]) / len) * 0.42,
            cy: from[1] + ((toward[1] - from[1]) / len) * 0.42,
            radius: 0.13,
            fill: color,
            text: String(step),
            textColor: labelTextColor(color),
          }
        : null,
    });
  }
  // Score pills sit in the target square's bottom-right corner. When several
  // arrows end on one square, the best move's sits lowest and later ones stack up.
  const slots = new Map<string, number>();
  for (const d of [...drawings].sort((a, b) => a.arrow.rank - b.arrow.rank)) {
    const text = d.arrow.label;
    if (!text) continue;
    const square = d.arrow.move.slice(2, 4);
    const slot = slots.get(square) ?? 0;
    slots.set(square, slot + 1);
    const width = labelWidth(text.length);
    d.label = {
      x: d.to[0] + 0.5 - width - 0.03,
      y: d.to[1] + 0.5 - LABEL_HEIGHT - 0.03 - slot * (LABEL_HEIGHT + 0.03),
      width,
      height: LABEL_HEIGHT,
      radius: LABEL_HEIGHT / 2,
      fill: d.color,
      text,
      textColor: labelTextColor(d.color),
      opacity: Math.max(d.opacity, 0.85),
    };
  }
  return drawings;
}
