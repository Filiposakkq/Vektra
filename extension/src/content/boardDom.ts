import { SELECTORS, queryFirst } from './selectors';

/** Piece code as used by chess.com classes: colour (w/b) + type (pnbrqk). */
export type PieceCode = `${'w' | 'b'}${'p' | 'n' | 'b' | 'r' | 'q' | 'k'}`;

/** Map from algebraic square ("e4") to piece code. */
export type Placement = Map<string, PieceCode>;

const PIECE_CLASS = /^([wb])([pnbrqk])$/;
const SQUARE_CLASS = /^square-([1-8])([1-8])$/;

export function findBoard(root: ParentNode = document): HTMLElement | null {
  return queryFirst<HTMLElement>(root, SELECTORS.board);
}

export function isFlipped(board: Element): boolean {
  return board.classList.contains(SELECTORS.boardFlippedClass);
}

/** Parse one piece element's classes, e.g. "piece wp square-52" -> ["e2", "wp"]. */
export function parsePieceClasses(classList: Iterable<string>): [string, PieceCode] | null {
  let code: PieceCode | null = null;
  let square: string | null = null;
  for (const c of classList) {
    const pm = PIECE_CLASS.exec(c);
    if (pm) code = (pm[1] + pm[2]) as PieceCode;
    const sm = SQUARE_CLASS.exec(c);
    if (sm) square = String.fromCharCode(96 + Number(sm[1])) + sm[2];
  }
  return code && square ? [square, code] : null;
}

/** Read the pieces currently drawn on the board. */
export function readPlacement(board: Element): Placement {
  const placement: Placement = new Map();
  for (const el of board.querySelectorAll(SELECTORS.piece)) {
    if (el.classList.contains(SELECTORS.pieceDraggingClass)) continue;
    const parsed = parsePieceClasses(el.classList);
    if (parsed) placement.set(parsed[0], parsed[1]);
  }
  return placement;
}

/** FEN piece-placement field for a placement map. */
export function placementToFenBoard(placement: Placement): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const code = placement.get(String.fromCharCode(97 + file) + rank);
      if (!code) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += code[0] === 'w' ? code[1].toUpperCase() : code[1];
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}
