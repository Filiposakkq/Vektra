import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
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
 * Material the side to move wins by capturing on `square`, with both sides
 * recapturing with their cheapest piece and either side free to stop
 * (static exchange evaluation). Only legal captures count, so pinned
 * pieces don't attack and pieces lined up behind each other join in.
 */
function exchangeGain(chess: Chess, square: Square): number {
  const target = chess.get(square);
  if (!target) return 0;
  let cheapest: { move: Move; value: number } | null = null;
  for (const m of chess.moves({ verbose: true })) {
    if (m.to !== square || m.flags.includes('e')) continue;
    if (m.promotion && m.promotion !== 'q') continue;
    const value = PIECE_VALUE[m.promotion ?? m.piece];
    if (!cheapest || value < cheapest.value) cheapest = { move: m, value };
  }
  if (!cheapest) return 0;
  const promotionGain = cheapest.move.promotion ? PIECE_VALUE[cheapest.move.promotion] - 1 : 0;
  chess.move(cheapest.move);
  const gain = PIECE_VALUE[target.type] + promotionGain - exchangeGain(chess, square);
  chess.undo();
  return Math.max(0, gain);
}

/**
 * True if the move gives up material: after it, the opponent can win at
 * least BRILLIANT_MIN_MATERIAL_LOSS more than the move itself captured,
 * by taking a piece worth at least BRILLIANT_MIN_PIECE_VALUE. That covers
 * the moved piece and pieces left en prise elsewhere (ignoring a threat).
 * Trades, and captures the mover can win back, don't count.
 */
export function isSacrifice(fenBefore: string, uci: string): boolean {
  const chess = new Chess(fenBefore);
  let move;
  try {
    move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return false;
  }
  const gained =
    (move.captured ? PIECE_VALUE[move.captured] : 0) +
    (move.promotion ? PIECE_VALUE[move.promotion] - 1 : 0);

  let worst = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== move.color || piece.type === 'k') continue;
      if (PIECE_VALUE[piece.type] < C.BRILLIANT_MIN_PIECE_VALUE) continue;
      worst = Math.max(worst, exchangeGain(chess, piece.square));
    }
  }
  return worst - gained >= C.BRILLIANT_MIN_MATERIAL_LOSS;
}
