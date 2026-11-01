import type { PvLine } from './uci';

/** What an engine search asks for and returns, the same on every platform. */

export interface SearchLimit {
  depth?: number;
  movetimeMs?: number;
}

export interface Strength {
  /** 0-20; 20 is full strength. */
  skillLevel: number;
  limitStrength: boolean;
  elo: number;
}

export interface AnalyzeRequest {
  fen: string;
  multipv: number;
  limit: SearchLimit;
  strength: Strength;
  /** Optional transposition-table size for analysis searches, in MiB. */
  hashMb?: number;
  /**
   * How the game reached `fen`: a starting position and the moves played
   * from it. With it the engine knows the repetitions so far and counts a
   * third repetition as a draw; without it the position is searched alone.
   */
  history?: { startFen: string; moves: string[] };
}

export interface SearchResult {
  /** Move the engine chose (affected by skill/Elo limits); null if no legal moves. */
  bestmove: string | null;
  /** Latest line for each multipv, sorted by rank. */
  lines: PvLine[];
}
