import type { AnalyzeRequest, SearchResult } from '../engine/protocol';
import { whitePov } from '../engine/uci';
import { ACCURACY, GAME_RATING, ANALYSIS_HASH_MB, ANALYSIS_MAX_MOVETIME_MS, ANALYSIS_MULTIPV } from './config';
import { openingName } from './openings';
import { isBookLineWith } from './openingBook';
import { replay } from '../chess/replay';
import { CATEGORIES, type Category } from './classify';
import { PHASES, gamePhases, type Phase } from './phases';
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
  /** Rough rating of how this side played this game, from its accuracy (see GAME_RATING). */
  rating: number;
  /** Accuracy in each part of the game; null when the side had no rated moves there. */
  phases: Record<Phase, PhaseSummary>;
}

export interface PhaseSummary {
  /** Accuracy of the moves that weren't book; null when every move was book, or none were played. */
  accuracy: number | null;
  /** Moves played in this phase, book moves included. */
  moves: number;
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
    multipv: ANALYSIS_MULTIPV,
    limit: { depth, movetimeMs: ANALYSIS_MAX_MOVETIME_MS },
    strength: { skillLevel: 20, limitStrength: false, elo: 3190 },
    hashMb: ANALYSIS_HASH_MB,
  });
  if (!result) return null;
  if (!result.lines.length) return { fen, score: { type: 'cp', value: 0 }, lines: [] };
  return { fen, score: whitePov(result.lines[0].score, turn), lines: result.lines };
}

export function emptyCounts(): Record<Category, number> {
  return Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
}

function standardDeviation(xs: number[]): number {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
}

/**
 * How much each move counts towards game accuracy: how much White's win %
 * swung in the positions up to the move (not after it, so a blunder doesn't
 * weigh itself up). See ACCURACY in config.ts.
 */
export function moveWeights(moves: MoveAnalysis[]): number[] {
  if (!moves.length) return [];
  const white = (m: MoveAnalysis, win: number) => (m.color === 'w' ? win : 100 - win);
  const series = [white(moves[0], moves[0].winBefore), ...moves.map((m) => white(m, m.winAfter))];
  const size = Math.max(ACCURACY.WINDOW_MIN, Math.min(ACCURACY.WINDOW_MAX, Math.floor(series.length / 10)));
  return moves.map((_, i) => {
    const from = Math.max(0, i + 1 - size);
    const deviation = standardDeviation(series.slice(from, Math.max(i + 1, from + 2)));
    return Math.max(ACCURACY.WEIGHT_MIN, Math.min(ACCURACY.WEIGHT_MAX, deviation));
  });
}

/**
 * Accuracy of a set of moves: the average of their weighted mean and a
 * harmonic mean with a floor (see ACCURACY). Null when there are none.
 * Book moves are left out: they are always accurate.
 */
function accuracyOf(moves: { m: MoveAnalysis; weight: number }[]): number | null {
  const scored = moves.filter(({ m }) => m.category !== 'book');
  if (!scored.length) return null;
  const weighted =
    scored.reduce((s, x) => s + x.m.accuracy * x.weight, 0) / scored.reduce((s, x) => s + x.weight, 0);
  const harmonic =
    scored.length / scored.reduce((s, x) => s + 1 / Math.max(x.m.accuracy, ACCURACY.HARMONIC_FLOOR), 0);
  return (weighted + harmonic) / 2;
}

/**
 * A rough rating for one side's play in one game, from its accuracy: a line
 * through chess.com's Game Rating of one reviewed game (see GAME_RATING),
 * rounded to 50 like chess.com's.
 */
export function gameRating(accuracy: number): number {
  const r = GAME_RATING.BASE + (accuracy - GAME_RATING.AT_ACCURACY) * GAME_RATING.PER_POINT;
  return Math.max(GAME_RATING.MIN, Math.min(GAME_RATING.MAX, Math.round(r / 50) * 50));
}

/** How a phase's accuracy reads as a rating, for its badge: Best down to Blunder. */
export function accuracyGrade(accuracy: number): Category {
  if (accuracy >= 99) return 'best';
  if (accuracy >= 90) return 'excellent';
  if (accuracy >= 80) return 'good';
  if (accuracy >= 70) return 'inaccuracy';
  if (accuracy >= 55) return 'mistake';
  return 'blunder';
}

export function summarize(moves: MoveAnalysis[]): { w: SideSummary; b: SideSummary } {
  const weights = moveWeights(moves);
  const phases = gamePhases(moves.map((m) => m.fenBefore));
  const side = (color: 'w' | 'b'): SideSummary => {
    const counts = emptyCounts();
    for (const m of moves) if (m.color === color) counts[m.category]++;
    const mine = moves.flatMap((m, i) => (m.color === color ? [{ m, weight: weights[i], phase: phases[i] }] : []));
    const accuracy = accuracyOf(mine) ?? 100;
    const byPhase = Object.fromEntries(
      PHASES.map((phase) => {
        const inPhase = mine.filter((x) => x.phase === phase);
        return [phase, { accuracy: accuracyOf(inPhase), moves: inPhase.length }];
      }),
    ) as Record<Phase, PhaseSummary>;
    return { accuracy, counts, rating: gameRating(accuracy), phases: byPhase };
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
        previousUci: uci[i - 1],
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
      previousUci: uci[i - 1],
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
