import { Chess } from 'chess.js';

/**
 * Build chess.com-like markup for tests, matching the real markup captured in
 * tests/fixtures/chesscom. Update both together when the site changes.
 */

export function boardHtml(fen: string, { flipped = false } = {}): string {
  const chess = new Chess(fen);
  const pieces: string[] = [];
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq) continue;
      const file = sq.square.charCodeAt(0) - 96;
      const rank = sq.square[1];
      pieces.push(`<div class="piece ${sq.color}${sq.type} square-${file}${rank}"></div>`);
    }
  }
  return `<wc-chess-board class="board${flipped ? ' flipped' : ''}" id="board-single">${pieces.join('')}</wc-chess-board>`;
}

const FIGURINE: Record<string, string> = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };

/** One ply node; pieces are rendered as figurine icons like chess.com does. */
function plyHtml(san: string, index: number, selected: boolean): string {
  const color = index % 2 === 0 ? 'white' : 'black';
  const m = /^([NBRQK])(.*)$/.exec(san);
  const promo = /^(.*=)([NBRQ])(.*)$/.exec(san);
  let inner = san;
  if (m) inner = `<span class="icon-font-chess ${FIGURINE[m[1]]}-${color}" data-figurine="${m[1]}"></span>${m[2]}`;
  else if (promo) inner = `${promo[1]}<span class="icon-font-chess ${FIGURINE[promo[2]]}-${color}" data-figurine="${promo[2]}"></span>${promo[3]}`;
  return `<div data-node="0-${index}" class="node ${color}-move main-line-ply"> <span class="node-highlight-content offset-for-annotation-icon${selected ? ' selected' : ''}">${inner} </span></div>`;
}

export function moveListHtml(
  sans: string[],
  { selected = sans.length, result }: { selected?: number | null; result?: string } = {},
): string {
  const rows: string[] = [];
  for (let i = 0; i < sans.length; i += 2) {
    const cells = [plyHtml(sans[i], i, selected === i + 1)];
    if (i + 1 < sans.length) cells.push(plyHtml(sans[i + 1], i + 1, selected === i + 2));
    rows.push(`<div class="main-line-row move-list-row" data-whole-move-number="${i / 2 + 1}">${cells.join('')}</div>`);
  }
  if (result) rows.push(`<div class="main-line-row move-list-row result-row"><span class="game-result">${result} </span></div>`);
  return `<wc-simple-move-list class="move-list chessboard-pkg-move-list-component" board-id="board-single"><div class="toggle-timestamps">${rows.join('')}</div></wc-simple-move-list>`;
}

/** FEN after playing the first `ply` moves of `sans`. */
export function fenAfter(sans: string[], ply = sans.length): string {
  const c = new Chess();
  for (const s of sans.slice(0, ply)) c.move(s);
  return c.fen();
}
