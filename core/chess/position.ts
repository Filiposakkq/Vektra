import { Chess, validateFen } from 'chess.js';

/**
 * A full FEN from the pieces alone (a FEN piece placement, rank 8 first) and
 * whose turn it is, for when the game's moves can't be read. Castling rights
 * are inferred from kings and rooks on their home squares; en passant is
 * unknown and left "-". Returns null if the result is not a legal FEN.
 */
export function fenFromBoard(board: string, turn: 'w' | 'b'): string | null {
  const ranks = board.split('/');
  if (ranks.length !== 8) return null;
  // The piece on a square ("e1"), as a FEN letter, or "" when empty.
  const at = (square: string): string => {
    const row = ranks[8 - Number(square[1])];
    let file = 0;
    for (const c of row) {
      if (c >= '1' && c <= '8') {
        file += Number(c);
      } else {
        if (file === square.charCodeAt(0) - 97) return c;
        file++;
      }
    }
    return '';
  };
  let castling = '';
  if (at('e1') === 'K') {
    if (at('h1') === 'R') castling += 'K';
    if (at('a1') === 'R') castling += 'Q';
  }
  if (at('e8') === 'k') {
    if (at('h8') === 'r') castling += 'k';
    if (at('a8') === 'r') castling += 'q';
  }
  const fen = `${board} ${turn} ${castling || '-'} - 0 1`;
  if (!validateFen(fen).ok || !possibleBoard(ranks)) return null;
  // The side that just moved can't have left its king in check.
  const other = turn === 'w' ? 'b' : 'w';
  try {
    if (new Chess(`${board} ${other} - - 0 1`).inCheck()) return null;
  } catch {
    return null;
  }
  return fen;
}

/**
 * False for piece counts no game can reach: a board read mid-animation can
 * show a moving piece on two squares, and Stockfish crashes on such positions.
 */
function possibleBoard(ranks: string[]): boolean {
  const count = (piece: string) => ranks.join('').split(piece).length - 1;
  for (const [pawn, pieces] of [['P', 'NBRQ'], ['p', 'nbrq']] as const) {
    const king = pawn === 'P' ? 'K' : 'k';
    if (count(king) !== 1 || count(pawn) > 8) return false;
    // Every piece beyond the starting set must be a promoted pawn.
    const start: Record<string, number> = { n: 2, b: 2, r: 2, q: 1 };
    const promoted = [...pieces].reduce((sum, p) => sum + Math.max(0, count(p) - start[p.toLowerCase()]), 0);
    if (count(pawn) + promoted > 8) return false;
  }
  return !/[Pp]/.test(ranks[0] + ranks[7]);
}

/**
 * The legal move that turns the position `fen` into the piece placement
 * `board`, or null if no single move does (two moves were made, or the board
 * was misread).
 */
export function moveBetween(fen: string, board: string): { uci: string; san: string } | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);
    const placement = chess.fen().split(' ')[0];
    chess.undo();
    if (placement === board) return { uci: move.from + move.to + (move.promotion ?? ''), san: move.san };
  }
  return null;
}

/**
 * True when `board` is `before` with exactly one piece gone and nothing else
 * changed: the user is dragging that piece (its square reads as empty until
 * the move lands), not a position to search.
 */
export function onePieceLifted(before: string, board: string): boolean {
  const squares = (placement: string) =>
    placement.split('/').flatMap((row) => [...row].flatMap((c) => (c >= '1' && c <= '8' ? Array<string>(Number(c)).fill('') : [c])));
  const a = squares(before);
  const b = squares(board);
  if (a.length !== 64 || b.length !== 64) return false;
  let gone = 0;
  for (let i = 0; i < 64; i++) {
    if (a[i] === b[i]) continue;
    if (b[i] !== '') return false;
    gone++;
  }
  return gone === 1;
}
