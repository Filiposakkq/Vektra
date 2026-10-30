import { Chess, DEFAULT_POSITION } from 'chess.js';

export interface ReplayResult {
  /** FEN after each ply; fens[0] is the start position. */
  fens: string[];
  /** UCI moves (e2e4, e7e8q) for each ply, for sending to the engine. */
  uci: string[];
  /** Index of the first SAN that could not be played, or null if all played. */
  failedAt: number | null;
}

/** Replay SAN moves with chess.js, recording the full FEN after every ply. */
export function replay(sans: readonly string[], startFen: string = DEFAULT_POSITION): ReplayResult {
  const chess = new Chess(startFen);
  const fens = [chess.fen()];
  const uci: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    try {
      const m = chess.move(sans[i], { strict: false });
      uci.push(m.from + m.to + (m.promotion ?? ''));
      fens.push(chess.fen());
    } catch {
      return { fens, uci, failedAt: i };
    }
  }
  return { fens, uci, failedAt: null };
}
