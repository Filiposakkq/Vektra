import { validateFen } from 'chess.js';

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
  return validateFen(fen).ok ? fen : null;
}
