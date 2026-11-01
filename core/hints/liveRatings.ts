import { whitePov, type PvLine } from '../engine/uci';
import {
  analyzeMove,
  terminalScore,
  type MoveAnalysis,
  type PositionEval,
} from '../analysis/moveAnalysis';
import type { GameView } from './types';
import { replay } from '../chess/replay';

/** Final evaluations kept, for rating moves without searching again. */
const EVALS_KEPT = 300;

/**
 * The user's move that led to this position (the side that just moved is the
 * side at the bottom of the board), or null.
 */
export async function userMoveToRate(
  state: GameView,
): Promise<{ beforeFen: string; ply: number; san: string; uci: string; book: boolean; previousUci?: string } | null> {
  if (state.inVariation || state.ply < 1 || state.source !== 'replay') return null;
  const userColor = state.flipped ? 'b' : 'w';
  const justMoved = state.fen.split(' ')[1] === 'w' ? 'b' : 'w';
  if (justMoved !== userColor) return null;
  const { fens, uci } = replay(state.sans.slice(0, state.ply));
  if (fens.length !== state.ply + 1) return null;
  const { isBookLine } = await import('../analysis/openingBook');
  return {
    beforeFen: fens[state.ply - 1],
    ply: state.ply,
    san: state.sans[state.ply - 1],
    uci: uci[state.ply - 1],
    book: await isBookLine(fens, state.ply),
    previousUci: uci[state.ply - 2],
  };
}

/**
 * Live move ratings in bot games: the user's move is rated (Best, Mistake...)
 * from the engine's evaluations before and after it. The platform draws the
 * visible rating on its square.
 */
export class LiveRatings {
  /** Final engine evaluations of recent positions. */
  private evals = new Map<string, PositionEval>();
  /** The user's last rated move, shown on its square. */
  private rating: { move: MoveAnalysis; sans: string[] } | null = null;
  /** The move waiting to be rated, once both evaluations are known. */
  pending: Awaited<ReturnType<typeof userMoveToRate>> = null;

  remember(state: GameView, lines: PvLine[]): void {
    const turn = state.fen.split(' ')[1] as 'w' | 'b';
    const score = terminalScore(state.fen) ?? (lines[0] ? whitePov(lines[0].score, turn) : null);
    if (!score) return;
    this.evals.delete(state.fen);
    this.evals.set(state.fen, { fen: state.fen, score, lines });
    if (this.evals.size > EVALS_KEPT) this.evals.delete(this.evals.keys().next().value!);
  }

  /** Rate the user's move that led to this position, once both evals are known. */
  rate(state: GameView, final: boolean): boolean {
    const p = this.pending;
    const before = p && this.evals.get(p.beforeFen);
    const after = this.evals.get(state.fen);
    if (!p || !before || !after) return false;
    if (final) this.pending = null;
    const move = analyzeMove(before, after, p, { book: p.book, previousUci: p.previousUci });
    this.rating = { move, sans: state.sans.slice(0, p.ply) };
    return true;
  }

  /** The last rating, if the game on the board still contains that move. */
  visible(state: GameView): MoveAnalysis | null {
    const r = this.rating;
    // Only for the user's latest move: shown after it and after the bot's reply.
    if (!r || state.inVariation || state.ply < r.move.ply || state.ply > r.move.ply + 1) return null;
    return r.sans.every((san, i) => state.sans[i] === san) ? r.move : null;
  }
}
