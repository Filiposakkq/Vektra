import { Chess } from 'chess.js';
import type { AnalyzeRequest } from '../engine/protocol';
import { scoreToCp, type PvLine } from '../engine/uci';
import type { BoardState } from './boardReader';
import { replay } from './fen';

/*
 * The game behind a hint: the moves that led to the position (sent with each
 * search so the engine sees repetitions), moves that draw at once, and the
 * position as if the side to move had passed (for threats).
 */

/** The game so far: every position (from the start) and the moves between them. */
export interface GameHistory {
  fens: string[];
  uci: string[];
}

/** The game that led to the board's position, or null when it can't be replayed from the move list. */
export function gameHistory(state: BoardState): GameHistory | null {
  if (state.source !== 'replay' || state.inVariation) return null;
  const { fens, uci, failedAt } = replay(state.sans.slice(0, state.ply));
  if (failedAt !== null || fens[fens.length - 1] !== state.fen) return null;
  return { fens, uci };
}

/**
 * The part of the game the engine needs: from the last capture or pawn move
 * on (nothing before it can repeat, and its FEN carries the 50-move count).
 * Keeping it short keeps cached searches reusable.
 */
export function searchHistory(game: GameHistory): NonNullable<AnalyzeRequest['history']> {
  let start = 0;
  for (let i = game.fens.length - 1; i >= 0; i--) {
    if (game.fens[i].split(' ')[4] === '0') {
      start = i;
      break;
    }
  }
  return { startFen: game.fens[start], moves: game.uci.slice(start) };
}

/** The game after one more move, or null if it is illegal. */
export function extendHistory(game: GameHistory, uci: string): GameHistory | null {
  const next = fenAfterMove(game.fens[game.fens.length - 1], uci);
  return next ? { fens: [...game.fens, next], uci: [...game.uci, uci] } : null;
}

/** True if playing the move ends the game in a draw at once: repetition, stalemate, 50 moves or too little material. */
export function drawsAfter(game: GameHistory, uci: string): boolean {
  const { startFen, moves } = searchHistory(game);
  try {
    const chess = new Chess(startFen);
    for (const move of [...moves, uci]) {
      chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
    }
    return chess.isDraw();
  } catch {
    return false;
  }
}

/** Most an "avoid draws" move may give up against the drawing best move, in centipawns. */
export const AVOID_DRAW_MAX_LOSS_CP = 100;
/** ...and the worst score (for the mover) it may leave: about level. */
export const AVOID_DRAW_MIN_SCORE_CP = -30;

/**
 * When the best move draws at once, the best of the other lines that doesn't
 * and keeps the mover about level (within AVOID_DRAW_MAX_LOSS_CP of the best
 * and no worse than AVOID_DRAW_MIN_SCORE_CP), or null to keep the best move.
 */
export function drawAvoidingLine(game: GameHistory, lines: readonly PvLine[], bestmove: string): PvLine | null {
  if (!drawsAfter(game, bestmove)) return null;
  const ordered = [...lines].sort((a, b) => a.multipv - b.multipv);
  const best = ordered.find((line) => line.pv[0] === bestmove) ?? ordered[0];
  if (!best) return null;
  const bestCp = scoreToCp(best.score);
  for (const line of ordered) {
    const move = line.pv[0];
    if (!move || move === bestmove || drawsAfter(game, move)) continue;
    const cp = scoreToCp(line.score);
    if (bestCp - cp <= AVOID_DRAW_MAX_LOSS_CP && cp >= AVOID_DRAW_MIN_SCORE_CP) return line;
  }
  return null;
}

/** The position after a UCI move, as the board reader would report it, or null if the move is illegal. */
export function fenAfterMove(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return chess.fen();
  } catch {
    return null;
  }
}

/**
 * The position with the other side to move and no en passant square, as if
 * the side to move had passed. Null when it is in check, where passing isn't
 * possible.
 */
export function nullMoveFen(fen: string): string | null {
  try {
    if (new Chess(fen).inCheck()) return null;
  } catch {
    return null;
  }
  const parts = fen.split(' ');
  if (parts.length < 4) return null;
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
}
