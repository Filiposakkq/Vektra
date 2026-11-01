import { Chess } from 'chess.js';
import type { AnalyzeRequest } from '../engine/search';
import { WEAKER_CANDIDATE_MULTIPV, WEAKER_MOVE_MULTIPV, type Settings } from '../settings';
import { nullMoveFen, searchHistory, type GameHistory } from './gameHistory';

/* The engine searches a hint makes: the main one, threats and weaker moves. */

/** Limits for the threat search, a quick pass before the main one. */
const THREAT_DEPTH = 10;
const THREAT_MOVETIME_MS = 300;

/** Limits for the quick weaker-move pass, which runs before the main search. */
const WEAKER_SEARCH_DEPTH = 10;
const WEAKER_SEARCH_MOVETIME_MS = 400;

/** Legal moves in a position, or null when the FEN can't be read. */
function legalMoveCount(fen: string): number | null {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return null;
  }
}

/**
 * Never ask for more lines than there are legal moves: the engine reports a
 * depth only once its last line arrives, so a line that can't exist (often
 * in check) would hold every update back until the search ends.
 */
export function capLines(fen: string, multipv: number): number {
  const legal = legalMoveCount(fen);
  return legal === null ? multipv : Math.max(1, Math.min(multipv, legal));
}

/** Engine memory for hint searches, in MiB; kept the same for every hint search, since changing it clears it. */
export const HINT_HASH_MB = 64;

/** Options every hint search shares, so the engine never resets between them. */
function hintEngineOptions(): Pick<AnalyzeRequest, 'hashMb'> {
  return { hashMb: HINT_HASH_MB };
}

/** The game's moves for a search, when known (see searchHistory). */
function historyOption(game?: GameHistory | null): Pick<AnalyzeRequest, 'history'> {
  return game ? { history: searchHistory(game) } : {};
}

export function buildRequest(fen: string, s: Settings, game?: GameHistory | null): AnalyzeRequest {
  return {
    fen,
    // Avoiding a draw needs at least one other line to choose from.
    multipv: capLines(fen, Math.max(s.arrows, s.weakenedShowsTopMoves ? WEAKER_MOVE_MULTIPV : 1, s.avoidDraws ? 2 : 1)),
    limit: s.searchMode === 'depth' ? { depth: s.depth } : { movetimeMs: s.movetimeMs },
    strength: { skillLevel: s.skillLevel, limitStrength: s.limitStrength, elo: s.elo },
    ...hintEngineOptions(),
    ...historyOption(game),
  };
}

/** The threat search for a position: the opponent's best move if the side to move passed. Null in check. */
export function buildThreatRequest(fen: string, s: Settings): AnalyzeRequest | null {
  const passed = nullMoveFen(fen);
  if (!passed) return null;
  return {
    fen: passed,
    multipv: 1,
    limit: s.searchMode === 'depth'
      ? { depth: Math.min(s.depth, THREAT_DEPTH) }
      : { movetimeMs: Math.min(s.movetimeMs, THREAT_MOVETIME_MS) },
    strength: { skillLevel: 20, limitStrength: false, elo: s.elo },
    ...hintEngineOptions(),
  };
}

/**
 * The quick search for weaker-move candidates, run next to the main one: many
 * lines, since the top few are usually close together, at a shallower limit so
 * it stays quick. The main search keeps few lines and its full depth.
 */
export function buildWeakerRequest(fen: string, s: Settings, game?: GameHistory | null): AnalyzeRequest {
  return {
    fen,
    multipv: capLines(fen, WEAKER_CANDIDATE_MULTIPV),
    limit: s.searchMode === 'depth'
      ? { depth: Math.min(s.depth, WEAKER_SEARCH_DEPTH) }
      : { movetimeMs: Math.min(s.movetimeMs, WEAKER_SEARCH_MOVETIME_MS) },
    strength: { skillLevel: s.skillLevel, limitStrength: s.limitStrength, elo: s.elo },
    ...hintEngineOptions(),
    ...historyOption(game),
  };
}
