/** Engine score, from the point of view of the side to move (as UCI reports it). */
export type Score = { type: 'cp'; value: number } | { type: 'mate'; value: number };

export interface PvLine {
  multipv: number;
  depth: number;
  score: Score;
  /** Principal variation in UCI notation; pv[0] is the suggested move. */
  pv: string[];
}

/**
 * Parse an "info ... pv ..." line. Returns null for info lines without a PV
 * and for bound-only scores (lowerbound/upperbound), which are not final.
 */
export function parseInfo(line: string): PvLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const tokens = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let score: Score | null = null;
  let pv: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    switch (tokens[i]) {
      case 'depth':
        depth = Number(tokens[++i]);
        break;
      case 'multipv':
        multipv = Number(tokens[++i]);
        break;
      case 'score': {
        const type = tokens[++i];
        const value = Number(tokens[++i]);
        if (type === 'cp' || type === 'mate') score = { type, value };
        break;
      }
      case 'lowerbound':
      case 'upperbound':
        return null;
      case 'pv':
        pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
    }
  }
  return score && pv.length ? { multipv, depth, score, pv } : null;
}

/**
 * Parse "bestmove e2e4 ponder e7e5". Returns the move, null for "(none)"
 * (no legal moves), or undefined if the line is not a bestmove line.
 */
export function parseBestMove(line: string): string | null | undefined {
  const m = /^bestmove\s+(\S+)/.exec(line);
  if (!m) return undefined;
  return m[1] === '(none)' ? null : m[1];
}

/** Flip a score to White's point of view. */
export function whitePov(score: Score, sideToMove: 'w' | 'b'): Score {
  return sideToMove === 'w' ? score : { type: score.type, value: -score.value };
}

/** Score as centipawns, with mates mapped to a large value (sign kept). */
export function scoreToCp(score: Score, mateCp = 10000): number {
  if (score.type === 'cp') return score.value;
  if (score.value === 0) return -mateCp; // side to move is mated
  return Math.sign(score.value) * (mateCp - Math.abs(score.value));
}

/** Human-readable score, e.g. "+0.52", "-1.30", "M3", "-M2". */
export function formatScore(score: Score): string {
  if (score.type === 'mate') return `${score.value < 0 ? '-' : ''}M${Math.abs(score.value)}`;
  const v = score.value / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}
