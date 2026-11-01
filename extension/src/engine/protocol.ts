import type { PvLine } from '@core/engine/uci';
import type { AnalyzeRequest, SearchResult } from '@core/engine/search';

export type { AnalyzeRequest, SearchLimit, SearchResult, Strength } from '@core/engine/search';

/** Port name used between content scripts and the engine host. */
export const ENGINE_PORT = 'vektra-engine';
/** Port name asking for the full-strength engine instead of the lite one. */
export const ENGINE_PORT_FULL = 'vektra-engine:full';
/** Runtime message asking the background worker to start the engine host. */
export const ENSURE_ENGINE = 'vektra:ensure-engine';

export type ClientMessage =
  | ({ type: 'analyze'; id: number } & AnalyzeRequest)
  | { type: 'stop' };

export type HostMessage =
  | { type: 'ready'; engine: 'lite' | 'full' }
  | { type: 'update'; id: number; lines: PvLine[] }
  | ({ type: 'done'; id: number } & SearchResult)
  | { type: 'error'; id?: number; message: string };
