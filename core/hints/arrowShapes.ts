/*
 * How hint arrows look, the same on every platform: colours, widths, fading,
 * and the shape of each arrow in board units (a square is 1 by 1, the board
 * 8 by 8). Drawing them is up to each platform.
 */

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
