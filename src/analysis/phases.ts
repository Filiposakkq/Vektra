/**
 * Which part of the game a position belongs to, after Lichess's split:
 *
 *  - The middlegame starts at the first position with at most
 *    MIDDLEGAME_PIECES rooks, knights, bishops and queens on the board (both
 *    sides), or with a back rank thinned out (fewer than 4 of a side's
 *    pieces still on it), and by ply MIDDLEGAME_BY at the latest.
 *  - The endgame starts at the first position with at most ENDGAME_PIECES.
 *
 * Once a phase starts it doesn't go back.
 */

export const PHASES = ['opening', 'middlegame', 'endgame'] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

const MIDDLEGAME_PIECES = 10;
const ENDGAME_PIECES = 6;
const MIDDLEGAME_BY = 30;
const BACK_RANK_SPARSE = 4;

function pieceCounts(fen: string): { pieces: number; whiteBackRank: number; blackBackRank: number } {
  const ranks = fen.split(' ')[0].split('/');
  const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
  return {
    pieces: count(ranks.join(''), /[nbrqNBRQ]/g),
    whiteBackRank: count(ranks[7] ?? '', /[A-Z]/g),
    blackBackRank: count(ranks[0] ?? '', /[a-z]/g),
  };
}

/** The phase of each position, given as FENs in game order (index = plies played). */
export function gamePhases(fens: string[]): Phase[] {
  let phase: Phase = 'opening';
  return fens.map((fen, ply) => {
    const { pieces, whiteBackRank, blackBackRank } = pieceCounts(fen);
    if (
      phase === 'opening' &&
      (pieces <= MIDDLEGAME_PIECES ||
        whiteBackRank < BACK_RANK_SPARSE ||
        blackBackRank < BACK_RANK_SPARSE ||
        ply >= MIDDLEGAME_BY)
    ) {
      phase = 'middlegame';
    }
    if (pieces <= ENDGAME_PIECES) phase = 'endgame';
    return phase;
  });
}
