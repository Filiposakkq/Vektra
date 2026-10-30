import type { AnalyzeRequest, SearchResult } from '../engine/protocol';
import { whitePov, type PvLine } from '../engine/uci';
import { ANALYSIS_MAX_MOVETIME_MS } from './config';
import { openingName } from './openings';
import { isBookLineWith } from './openingBook';
import { replay } from '../content/fen';
import { CATEGORIES, type Category } from './classify';
import { analyzeMove, terminalScore, type MoveAnalysis, type PositionEval } from './moveAnalysis';

export { uciToSan } from './chessNotation';
export { analyzeMove, describeMoveAnalysis, terminalScore } from './moveAnalysis';
export type { MoveAnalysis, PositionEval } from './moveAnalysis';

/** Anything that can run a search, e.g. EngineClient or UciEngine. */
export interface Analyzer {
  analyze(req: AnalyzeRequest): Promise<SearchResult | null>;
}

export interface SideSummary {
  accuracy: number;
  counts: Record<Category, number>;
}

export interface GameAnalysis {
  sans: string[];
  /** Opening name (with ECO code) from the book moves, if any. */
  opening?: string;
  /** Engine used, for display. */
  engine?: string;
  depth: number;
  /** One entry per position, index = plies played (0 = start). */
  positions: PositionEval[];
  moves: MoveAnalysis[];
  summary: { w: SideSummary; b: SideSummary };
}

async function evaluatePosition(
  engine: Analyzer,
  fen: string,
  depth: number,
): Promise<PositionEval | null> {
  const turn = fen.split(' ')[1] as 'w' | 'b';
  const terminal = terminalScore(fen);
  if (terminal) return { fen, score: terminal, lines: [] };
  const result = await engine.analyze({
    fen,
    multipv: 2,
    limit: { depth, movetimeMs: ANALYSIS_MAX_MOVETIME_MS },
    strength: { skillLevel: 20, limitStrength: false, elo: 3190 },
    hashMb: 64,
  });
  if (!result) return null;
  if (!result.lines.length) return { fen, score: { type: 'cp', value: 0 }, lines: [] };
  return { fen, score: whitePov(result.lines[0].score, turn), lines: result.lines };
}

export function emptyCounts(): Record<Category, number> {
  return Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
}

export function summarize(moves: MoveAnalysis[]): { w: SideSummary; b: SideSummary } {
  const side = (color: 'w' | 'b'): SideSummary => {
    const mine = moves.filter((m) => m.color === color);
    const counts = emptyCounts();
    for (const m of mine) counts[m.category]++;
    // Harmonic mean, so a few bad moves pull the score down the way they do
    // on chess.com. Book moves are left out: they are always accurate.
    const scored = mine.filter((m) => m.category !== 'book');
    const accuracy = scored.length ? scored.length / scored.reduce((s, m) => s + 1 / Math.max(m.accuracy, 1), 0) : 100;
    return { accuracy, counts };
  };
  return { w: side('w'), b: side('b') };
}

/** True if every move up to and including this ply stayed in the opening book. */
export function isBookLine(fens: string[], ply: number): boolean {
  return isBookLineWith(openingName, fens, ply);
}

/** Classify every move given evaluations of every position. */
export function classifyGame(sans: string[], uci: string[], positions: PositionEval[]): MoveAnalysis[] {
  const moves: MoveAnalysis[] = [];
  const fens = positions.map((p) => p.fen);
  for (let i = 0; i < uci.length; i++) {
    moves.push(
      analyzeMove(positions[i], positions[i + 1], { ply: i + 1, san: sans[i], uci: uci[i] }, {
        book: isBookLine(fens, i + 1),
        previous: moves[i - 1]?.category,
      }),
    );
  }
  return moves;
}

/** Name of the deepest named opening position reached by book moves. */
export function gameOpening(positions: PositionEval[], moves: MoveAnalysis[]): string | undefined {
  let name: string | undefined;
  for (const m of moves) {
    if (m.category !== 'book') break;
    const n = openingName(positions[m.ply].fen);
    if (n && n !== 'Opening') name = n;
  }
  return name;
}

/**
 * Run the engine over every position of the game. onProgress receives the
 * number of positions done and the total. Resolves to null if cancelled
 * (signal aborted, or the engine dropped the search).
 */
/** Positions per run of the game handed to one engine (see analyzeGame). */
const RUN_LENGTH = 6;

export async function analyzeGame(
  sans: string[],
  engine: Analyzer | Analyzer[],
  {
    depth,
    onProgress,
    onPartial,
    signal,
  }: {
    depth: number;
    onProgress?: (done: number, total: number) => void;
    /**
     * Moves rated so far, indexed by ply - 1 (gaps for moves not rated yet).
     * Final ratings come with the result; a partial one can still change
     * (a Miss depends on the move before it).
     */
    onPartial?: (moves: (MoveAnalysis | undefined)[]) => void;
    signal?: AbortSignal;
  },
): Promise<GameAnalysis | null> {
  const { fens, uci, failedAt } = replay(sans);
  const played = failedAt === null ? sans : sans.slice(0, failedAt);
  const engines = Array.isArray(engine) ? engine : [engine];
  const positions: (PositionEval | undefined)[] = new Array(fens.length);
  const partial: (MoveAnalysis | undefined)[] = new Array(played.length);
  const ratedWithPrevious: (MoveAnalysis['category'] | undefined)[] = new Array(played.length);
  const hasRated = new Array<boolean>(played.length).fill(false);
  let done = 0;
  let failed = false;

  // The game is cut into short runs of consecutive positions, handed out to
  // whichever engine is free. Each run is searched from its end backwards,
  // like Lichess: the engine's hash table still holds the position after the
  // current one, so the search reaches the same depth sooner. Short runs keep
  // every engine busy to the end, even when one part of the game is hard.
  const runs: number[][] = [];
  for (let from = 0; from < fens.length; from += RUN_LENGTH) {
    runs.push(Array.from({ length: Math.min(RUN_LENGTH, fens.length - from) }, (_, k) => from + k).reverse());
  }
  let nextRun = 0;

  // A move can be rated once the positions before and after it are known.
  const rate = (i: number): boolean => {
    if (i < 0 || i >= played.length || !positions[i] || !positions[i + 1]) return false;
    const previous = partial[i - 1]?.category;
    if (hasRated[i] && ratedWithPrevious[i] === previous) return false;
    partial[i] = analyzeMove(positions[i]!, positions[i + 1]!, { ply: i + 1, san: played[i], uci: uci[i] }, {
      book: isBookLine(fens, i + 1),
      previous,
    });
    ratedWithPrevious[i] = previous;
    hasRated[i] = true;
    return true;
  };

  const work = async (e: Analyzer) => {
    while (nextRun < runs.length) {
      for (const i of runs[nextRun++]) {
        if (failed || signal?.aborted) return;
        const ev = await evaluatePosition(e, fens[i], depth);
        if (!ev) {
          failed = true;
          return;
        }
        positions[i] = ev;
        onProgress?.(++done, fens.length);
        if (onPartial) {
          const previousRated = rate(i - 1);
          const currentRated = rate(i);
          if (previousRated || currentRated) onPartial([...partial]);
        }
      }
    }
  };
  await Promise.all(engines.map(work));
  // Not .some(): it skips the holes of an array that was never filled.
  if (failed || signal?.aborted || Array.from(positions).some((p) => !p)) return null;
  const all = positions as PositionEval[];
  const moves = classifyGame(played, uci, all);
  return { sans: played, opening: gameOpening(all, moves), depth, positions: all, moves, summary: summarize(moves) };
}
