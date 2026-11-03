import { Chess } from 'chess.js';
import { CATEGORY_STYLE } from '@core/analysis/categoryStyle';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '@core/analysis/classify';
import { accuracyGrade, analyzeGame, type GameAnalysis } from '@core/analysis/gameAnalysis';
import { PHASES, PHASE_LABELS } from '@core/analysis/phases';
import { winPercent } from '@core/analysis/winProbability';
import { UciEngine } from '@core/engine/uciEngine';
import { arrowScoreLabel } from '@core/hints/hintArrows';
import type { Arrow } from '@core/hints/types';
import { articleFor } from '@ext/ui/analysisPanel';
import { NativeLayer, categoryPng } from './nativeLayer';

/**
 * The app's engine page, hidden in the app (EnginePage.kt) while its
 * screens are native: it reads games (chess.js), names openings, analyses
 * games with Stockfish and the extension's rules (core/analysis), and works
 * out what the review board draws (core/draw through NativeLayer, painted
 * by OverlayView like the hints in games). Every call answers through
 * VektraEngine.reply(id, json).
 */

declare global {
  interface Window {
    VektraEngine?: { reply(id: number, json: string): void; progress(done: number, total: number): void };
  }
}

const reply = (id: number, value: unknown) => window.VektraEngine?.reply(id, JSON.stringify(value));
/** Two engines side by side: the phone's two fast cores. */
const ENGINES = 2;
const layer = new NativeLayer();
let workers: Worker[] = [];
let abort: AbortController | null = null;
/** The game analysed last, for the board's frames. */
let analysis: GameAnalysis | null = null;

/** The name of the last opening the game passed through, from the book (core/analysis/openings). */
async function openingOf(fens: string[]): Promise<string | null> {
  const { openingName } = await import('@core/analysis/openings');
  let name: string | null = null;
  for (const fen of fens) name = openingName(fen) ?? name;
  return name;
}

/** A game from its PGN or its moves: every position, every move, and its opening. */
async function game(id: number, input: { pgn?: string; sans?: string[] }): Promise<void> {
  try {
    const chess = new Chess();
    if (input.pgn) chess.loadPgn(input.pgn);
    else for (const san of input.sans ?? []) chess.move(san);
    const moves = chess.history({ verbose: true });
    const fens = [moves[0]?.before ?? chess.fen(), ...moves.map((m) => m.after)];
    reply(id, {
      sans: moves.map((m) => m.san),
      fens,
      moves: moves.map((m) => ({ from: m.from, to: m.to, san: m.san })),
      opening: await openingOf(fens),
    });
  } catch (e) {
    reply(id, { error: String(e) });
  }
}

function stopEngines(): void {
  abort?.abort();
  abort = null;
  workers.forEach((w) => w.terminate());
  workers = [];
}

/** Analyses a game; progress goes to VektraEngine.progress, the summary to the reply. */
async function analyze(id: number, input: { sans: string[]; depth: number }): Promise<void> {
  stopEngines();
  analysis = null;
  const signal = (abort = new AbortController()).signal;
  let crashed = false;
  const engines = Array.from({ length: ENGINES }, () => {
    const worker = new Worker('engine/stockfish-19-lite-single.js');
    const engine = new UciEngine((command) => worker.postMessage(command));
    worker.onmessage = (event: MessageEvent) => engine.handleLine(String(event.data));
    // A dead worker never answers: give up on this run.
    worker.onerror = () => {
      crashed = true;
      stopEngines();
      reply(id, { error: 'The engine stopped. Try again.' });
    };
    workers.push(worker);
    return engine;
  });
  const result = await analyzeGame(input.sans, engines, {
    depth: input.depth,
    onProgress: (done, total) => !signal.aborted && window.VektraEngine?.progress(done, total),
    signal,
  });
  if (signal.aborted || crashed) return;
  stopEngines();
  analysis = result;
  if (!result) return reply(id, { error: 'The analysis failed. Try again.' });
  reply(id, summary(result));
}

/** What the review shows, worded as the extension's panel words it. */
function summary(a: GameAnalysis) {
  const side = (color: 'w' | 'b') => {
    const s = a.summary[color];
    return {
      accuracy: s.accuracy,
      rating: s.rating,
      counts: CATEGORIES.map((c) => s.counts[c]),
      phases: PHASES.map((p) => {
        const ph = s.phases[p];
        return { moves: ph.moves, accuracy: ph.accuracy, grade: ph.accuracy === null ? 'book' : accuracyGrade(ph.accuracy) };
      }),
    };
  };
  return {
    opening: a.opening ?? null,
    engine: a.engine ?? 'Stockfish',
    depth: a.depth,
    white: side('w'),
    black: side('b'),
    categories: CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c], color: CATEGORY_STYLE[c].color })),
    phases: PHASES.map((p) => PHASE_LABELS[p]),
    // White's win chance after each ply (0 = the start), for the graph.
    wins: a.positions.map((p) => winPercent(p.score)),
    moves: a.moves.map((m) => ({
      category: m.category,
      verdict: `${Math.ceil(m.ply / 2)}${m.color === 'w' ? '.' : '...'} ${m.san} was ${articleFor(CATEGORY_LABELS[m.category])}`,
      reason: m.reason ?? null,
      details: `Move accuracy ${m.accuracy.toFixed(1)}%. Win chance ${m.winBefore.toFixed(1)}% to ${m.winAfter.toFixed(1)}%.` +
        (m.bestSan && m.bestMove !== m.uci && m.category !== 'best' ? ` Best was ${m.bestSan}.` : ''),
    })),
  };
}

/**
 * The review board's marks at a ply, painted by the app (VektraNative.render):
 * the move's rating badge, the better move when there was one (as the panel
 * says "Best was"), and the engine's line if asked for.
 */
function frame(input: { ply: number; line: boolean; flipped: boolean }): void {
  const position = analysis?.positions[input.ply];
  if (!analysis || !position) return layer.clear();
  const played = analysis.moves[input.ply - 1];
  const arrows: Arrow[] = [];
  if (played?.bestMove && played.bestMove !== played.uci && played.category !== 'best' && played.category !== 'book') {
    arrows.push({ move: played.bestMove, rank: 0 });
  }
  if (input.line) {
    const label = arrowScoreLabel(position.score);
    const line = position.lines[0]?.pv.slice(0, 3) ?? [];
    arrows.push(...line.map((m, i) => ({ move: m, rank: i, step: i + 1, ...(i === 0 ? { label } : {}) })));
  }
  layer.draw(arrows, input.flipped, played ? { square: played.uci.slice(2, 4), category: played.category as Category, title: played.san } : null);
}

/** The rating icons as PNGs (base64), once all are drawn. */
function icons(id: number): void {
  const all = () => CATEGORIES.every((c) => categoryPng(c));
  const send = () => reply(id, Object.fromEntries(CATEGORIES.map((c) => [c, categoryPng(c)])));
  if (all()) return send();
  const wait = setInterval(() => {
    if (!all()) return;
    clearInterval(wait);
    send();
  }, 50);
}

Object.assign(window, {
  vektra: { game, analyze, frame, icons, cancel: () => { stopEngines(); analysis = null; } },
});
console.info('[Vektra] engine page ready');
