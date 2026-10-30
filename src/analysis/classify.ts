import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { ACCURACY, CLASSIFICATION as C } from './config';

export const CATEGORIES = [
  'book',
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  book: 'Book',
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Miss',
  blunder: 'Blunder',
};

const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export interface MoveFacts {
  /** Win % for the mover with best play, before the move. */
  winBefore: number;
  /** Win % for the mover after the move played. */
  winAfter: number;
  /** Win % for the mover after the engine's second-best move, if there was one. */
  winSecondBest?: number;
  /** The move played was the engine's top choice. */
  isTopMove: boolean;
  /**
   * The move is one of the engine's other lines, scored within
   * BEST_MAX_CP_LOSS of the top move (an equally good alternative).
   */
  equalAlternative?: boolean;
  /** The position after the move is a known opening position, reached by book moves only. */
  book?: boolean;
  /** Only one legal move was available. */
  forced: boolean;
  /** The move gives up material (see isSacrifice). */
  sacrifice: boolean;
  /** The opponent's previous move was a Mistake or Blunder. */
  opponentErred: boolean;
}

/** Win % lost by the move, never negative. */
export function winLoss(f: Pick<MoveFacts, 'winBefore' | 'winAfter'>): number {
  return Math.max(0, f.winBefore - f.winAfter);
}

export function classifyMove(f: MoveFacts): Category {
  const loss = winLoss(f);
  const best = f.isTopMove || !!f.equalAlternative;

  if (f.book) return 'book';
  if (f.forced) return 'best';

  if (
    f.sacrifice &&
    (f.isTopMove || loss <= C.BRILLIANT_MAX_LOSS) &&
    f.winBefore >= C.BRILLIANT_MIN_WIN_BEFORE &&
    f.winBefore <= C.BRILLIANT_MAX_WIN_BEFORE &&
    f.winAfter >= C.BRILLIANT_MIN_WIN_AFTER
  ) {
    return 'brilliant';
  }

  if (
    best &&
    f.winSecondBest !== undefined &&
    f.winBefore - f.winSecondBest >= C.GREAT_MIN_GAP &&
    f.winBefore <= C.GREAT_MAX_WIN_BEFORE
  ) {
    return 'great';
  }

  if (best) return 'best';
  if (loss <= C.EXCELLENT_MAX_LOSS) return 'excellent';
  if (loss <= C.GOOD_MAX_LOSS) return 'good';

  if (f.opponentErred && f.winBefore >= C.MISS_MIN_WIN_BEFORE && f.winAfter >= C.MISS_MIN_WIN_AFTER) {
    return 'miss';
  }

  if (loss <= C.INACCURACY_MAX_LOSS) return 'inaccuracy';
  if (loss <= C.MISTAKE_MAX_LOSS) return 'mistake';
  return 'blunder';
}

/** Accuracy (0-100) of a single move from its win % loss. */
export function moveAccuracy(loss: number): number {
  const a = ACCURACY.A * Math.exp(-ACCURACY.B * loss) - ACCURACY.C;
  return Math.min(100, Math.max(0, a));
}

/**
 * True if the move leaves a piece worth at least BRILLIANT_MIN_PIECE_VALUE
 * where the opponent can win it: the moved piece (or, for a capture, the
 * capturing piece) is attacked by something cheaper, or attacked and not
 * defended. Trades (capturing something at least as valuable) don't count.
 */
export function isSacrifice(fenBefore: string, uci: string): boolean {
  const chess = new Chess(fenBefore);
  let move;
  try {
    move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return false;
  }
  const to = move.to as Square;
  const piece = chess.get(to);
  if (!piece) return false;
  const value = PIECE_VALUE[piece.type];
  if (value < C.BRILLIANT_MIN_PIECE_VALUE || piece.type === 'k') return false;
  if (move.captured && PIECE_VALUE[move.captured] >= value) return false;

  const opponent = piece.color === 'w' ? 'b' : 'w';
  const attackers = chess.attackers(to, opponent);
  if (!attackers.length) return false;
  const cheapest = Math.min(...attackers.map((sq) => PIECE_VALUE[chess.get(sq)!.type]));
  if (cheapest < value) return true;
  const defended = chess.attackers(to, piece.color).length > 0;
  return !defended;
}
