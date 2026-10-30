import type { PvLine } from './uci';

/** Port name used between content scripts and the engine host. */
export const ENGINE_PORT = 'vektra-engine';
/** Port name asking for the full-strength engine instead of the lite one. */
export const ENGINE_PORT_FULL = 'vektra-engine:full';
/** Runtime message asking the background worker to start the engine host. */
export const ENSURE_ENGINE = 'vektra:ensure-engine';

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
}

export interface SearchResult {
  /** Move the engine chose (affected by skill/Elo limits); null if no legal moves. */
  bestmove: string | null;
  /** Latest line for each multipv, sorted by rank. */
  lines: PvLine[];
}

export type ClientMessage =
  | ({ type: 'analyze'; id: number } & AnalyzeRequest)
  | { type: 'stop' };

export type HostMessage =
  | { type: 'ready'; engine: 'lite' | 'full' }
  | { type: 'update'; id: number; lines: PvLine[] }
  | ({ type: 'done'; id: number } & SearchResult)
  | { type: 'error'; id?: number; message: string };
