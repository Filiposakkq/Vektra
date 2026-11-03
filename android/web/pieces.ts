/**
 * Vektra's own chess pieces for the review board: flat shapes on a 45 × 45
 * grid, outlined so they read on both square colours. White pieces are light
 * with dark lines, black ones dark with light details.
 */

const BASE = '<rect x="10.5" y="33" width="24" height="6.5" rx="1.8"/>';

/** Each piece: its body (filled and outlined) and its detail lines. */
const SHAPES: Record<string, { body: string; details?: string }> = {
  p: {
    body: '<circle cx="22.5" cy="14" r="5.5"/><path d="M19 20h7l4.5 13h-16z"/><rect x="13" y="33" width="19" height="6.5" rx="1.8"/>',
  },
  r: {
    body: `<path d="M11.5 8.5h5v4h3.5v-4h5v4h3.5v-4h5V16l-3.5 3v14h-15V19l-3.5-3z"/>${BASE}`,
    details: '<path d="M15 19h15"/>',
  },
  n: {
    body: `<path d="M14 33c0-5 2.5-8.5 6.5-11.5l-5.5 3.5c-1.2.8-2.7.6-3.6-.6l-1.2-1.6c-.7-1-.6-2.3.3-3.1C14.5 15.5 18 12 22 10.5l1.5-3.5 2.5 3.5C32 12 35 20 34.5 33z"/>${BASE}`,
    details: '<circle cx="20" cy="15.5" r="1.2"/><path d="M26.5 13c3 3 4.5 9 4.5 17"/>',
  },
  b: {
    body: `<circle cx="22.5" cy="7.5" r="2.5"/><path d="M22.5 10c-5.5 4-8 8.5-8 13 0 3.8 3.3 6.5 8 6.5s8-2.7 8-6.5c0-4.5-2.5-9-8-13z"/><path d="M18 29.5h9l1.5 3.5h-12z"/>${BASE}`,
    details: '<path d="M20 20.5l5-5M19 26h7"/>',
  },
  q: {
    body: `<path d="M11.5 33L9 15.5l4.5 9.5 2.5-12.5 4 11.5 2.5-13.5 2.5 13.5 4-11.5 2.5 12.5 4.5-9.5L33.5 33z"/><circle cx="9" cy="14" r="2.2"/><circle cx="16" cy="11.5" r="2.2"/><circle cx="22.5" cy="9.5" r="2.2"/><circle cx="29" cy="11.5" r="2.2"/><circle cx="36" cy="14" r="2.2"/>${BASE}`,
    details: '<path d="M12.5 29h20"/>',
  },
  k: {
    body: `<circle cx="22.5" cy="18" r="3.8"/><path d="M12 33c-3-7.5 1-13.5 6-13 2.4.2 4 2 4.5 4 .5-2 2.1-3.8 4.5-4 5-.5 9 5.5 6 13z"/>${BASE}`,
    details: '<path d="M13 29h19"/>',
  },
};

/** The cross on the king, drawn over its outline. */
const KING_CROSS = '<path d="M22.5 5v9M19 8.5h7"/>';

/** A piece as an SVG element string; `piece` is a FEN letter (upper case is White). */
export function pieceSvg(piece: string): string {
  const white = piece === piece.toUpperCase();
  const shape = SHAPES[piece.toLowerCase()];
  const [fill, line, detail] = white ? ['#f7f4ee', '#1f1d1b', '#1f1d1b'] : ['#2b2826', '#111', '#e9e4dc'];
  const cross = piece.toLowerCase() === 'k' ? `<g stroke="${line}" stroke-width="4.2">${KING_CROSS}</g><g stroke="${fill}" stroke-width="1.8">${KING_CROSS}</g>` : '';
  return (
    `<svg class="piece" viewBox="0 0 45 45" aria-hidden="true" stroke-linejoin="round" stroke-linecap="round">` +
    cross +
    `<g fill="${fill}" stroke="${line}" stroke-width="1.5">${shape.body}</g>` +
    (shape.details ? `<g fill="none" stroke="${detail}" stroke-width="1.5">${shape.details}</g>` : '') +
    `</svg>`
  );
}
