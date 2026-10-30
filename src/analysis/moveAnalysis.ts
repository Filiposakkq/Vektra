import { Chess } from 'chess.js';
import { whitePov, type PvLine, type Score } from '../engine/uci';
import { CLASSIFICATION } from './config';
import {
  classifyMove,
  isSacrifice,
  moveAccuracy,
  winLoss,
  type Category,
} from './classify';
import { winPercent } from './winProbability';
import { uciToSan } from './chessNotation';

export interface PositionEval {
  fen: string;
  /** Score from White's point of view. */
  score: Score;
  /** Engine lines (side-to-move point of view), best first. Empty if the game is over. */
  lines: PvLine[];
}

export interface MoveAnalysis {
  /** 1-based ply number. */
  ply: number;
  color: 'w' | 'b';
  san: string;
  uci: string;
  fenBefore: string;
  bestMove: string | null;
  /** bestMove in SAN, for display. */
  bestSan: string | null;
  /** Engine's preferred line from the position before the move (UCI). */
  bestLine: string[];
  /** Win % for the mover, before (with best play) and after the move played. */
  winBefore: number;
  winAfter: number;
  loss: number;
  accuracy: number;
  category: Category;
}

/** A concise explanation shared by move-list, board and analysis-panel badges. */
export function describeMoveAnalysis(move: MoveAnalysis): string {
  const winChances = `${move.winBefore.toFixed(1)}% to ${move.winAfter.toFixed(1)}%`;
  const best = move.bestSan && move.bestMove !== move.uci ? ` Best was ${move.bestSan}.` : '';
  return `${move.san}: ${move.category}; estimated move accuracy ${move.accuracy.toFixed(1)}%; ` +
    `win chances ${winChances}.${best} Engine estimate, not an official rating.`;
}

/** White-POV evaluation of a finished position, or null if the game goes on. */
export function terminalScore(fen: string): Score | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { type: 'mate', value: chess.turn() === 'w' ? -1 : 1 };
  if (chess.isDraw()) return { type: 'cp', value: 0 };
  return null;
}

/** Centipawns for a color from a White-POV score; slower mates score as worse. */
function cpFor(score: Score, color: 'w' | 'b'): number {
  const cp =
    score.type === 'cp' ? score.value : Math.sign(score.value || -1) * (10000 - 100 * Math.abs(score.value));
  return color === 'w' ? cp : -cp;
}

function winFor(score: Score, color: 'w' | 'b'): number {
  if (score.type === 'mate') {
    // Only the side that has the mate cares how far away it is.
    const mine = color === 'w' ? score.value : -score.value;
    if (mine <= 0) return 0;
    return Math.max(CLASSIFICATION.MATE_FLOOR, 100 - CLASSIFICATION.MATE_STEP * (mine - 1));
  }
  const w = winPercent(score, CLASSIFICATION.WIN_PROB_K);
  return color === 'w' ? w : 100 - w;
}

/** Classify one move from evaluations of the positions before and after it. */
export function analyzeMove(
  before: PositionEval,
  after: PositionEval,
  move: { ply: number; san: string; uci: string },
  context: { book: boolean; previous?: Category },
): MoveAnalysis {
  const color = before.fen.split(' ')[1] as 'w' | 'b';
  const winBefore = winFor(before.score, color);
  const winAfter = winFor(after.score, color);
  const second = before.lines[1];
  const winSecondBest = second ? winFor(whitePov(second.score, color), color) : undefined;
  const bestMove = before.lines[0]?.pv[0] ?? null;
  const facts = {
    winBefore,
    winAfter,
    winSecondBest,
    book: context.book,
    equalAlternative: before.lines.slice(1).some(
      (line) =>
        line.pv[0] === move.uci &&
        cpFor(whitePov(before.lines[0].score, color), color) - cpFor(whitePov(line.score, color), color) <=
          CLASSIFICATION.BEST_MAX_CP_LOSS,
    ),
    isTopMove: bestMove === move.uci,
    forced: new Chess(before.fen).moves().length === 1,
    sacrifice: isSacrifice(before.fen, move.uci),
    opponentErred: context.previous === 'mistake' || context.previous === 'blunder',
  };
  const loss = winLoss(facts);
  return {
    ply: move.ply,
    color,
    san: move.san,
    uci: move.uci,
    fenBefore: before.fen,
    bestMove,
    bestSan: bestMove ? uciToSan(before.fen, bestMove) : null,
    bestLine: before.lines[0]?.pv ?? [],
    winBefore,
    winAfter,
    loss,
    accuracy: moveAccuracy(loss),
    category: classifyMove(facts),
  };
}
