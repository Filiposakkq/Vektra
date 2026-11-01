import { fenFromBoard } from '@core/chess/position';
import { whitePov, type PvLine } from '@core/engine/uci';
import { UciEngine } from '@core/engine/uciEngine';
import { hintMoveArrows, scoreArrows, steadyLines } from '@core/hints/hintArrows';
import { buildRequest } from '@core/hints/hintRequests';
import { DEFAULT_SETTINGS } from '@core/settings';
import { BoardLayer } from './board';

/**
 * The Android app's overlay page. The app lays it over the Chess.com board in
 * bot games and calls `vektra.show()` with what it read; this page runs
 * Stockfish and the shared hint code (core/) and draws the result.
 */

/** What the app read from the Chess.com screen. */
interface Reading {
  /** FEN piece placement, rank 8 first. */
  board: string;
  /** Whose turn it is, or null when the move list didn't tell. */
  turn: 'w' | 'b' | null;
  /** Shown from Black's side, i.e. the user plays Black. */
  flipped: boolean;
}

/** Don't draw lines shallower than this while searching; early depths flicker (as in the extension). */
const MIN_DRAW_DEPTH = 8;

const settings = DEFAULT_SETTINGS;
const worker = new Worker('engine/stockfish-19-lite-single.js');
const engine = new UciEngine((command) => worker.postMessage(command));
worker.onmessage = (event: MessageEvent) => engine.handleLine(String(event.data));
worker.onerror = (event) => console.error(`[Vektra] the engine failed: ${event.message}`);
const layer = new BoardLayer(document.getElementById('board') as unknown as SVGSVGElement, document.getElementById('eval')!);

let current = '';

function show(reading: Reading): void {
  const key = `${reading.board} ${reading.turn} ${reading.flipped}`;
  if (key === current) return;
  current = key;
  layer.clear();
  // Hints only on the user's turn; the user plays from the bottom of the board.
  const user = reading.flipped ? 'b' : 'w';
  const fen = reading.turn === user ? fenFromBoard(reading.board, reading.turn) : null;
  if (!fen) {
    engine.stop();
    if (reading.turn === user) console.warn(`[Vektra] not a legal position: ${reading.board}`);
    return;
  }
  const turn = reading.turn!;
  const minDepth = Math.min(MIN_DRAW_DEPTH, settings.searchMode === 'depth' ? settings.depth : 1);
  const started = performance.now();
  let shown: PvLine[] = [];
  let lastTop: string | null = null;

  const draw = (lines: PvLine[], bestmove: string | null | undefined) => {
    const arrows = scoreArrows(
      hintMoveArrows({ kind: 'game', fen, settings, lines, weakerLines: [], bestmove, moveChoice: null }),
      lines,
      turn,
      { showScores: settings.arrowScores, hideWorse: !settings.weakenedShowsTopMoves, maxWinLoss: settings.hideWorseWinLoss },
    ).map((arrow) => (bestmove === undefined ? { ...arrow, provisional: true } : arrow));
    layer.draw(arrows, reading.flipped);
    if (lines[0]) layer.eval(whitePov(lines[0].score, turn), reading.flipped);
  };

  void engine
    .analyze(buildRequest(fen, settings, null), (lines) => {
      if (key !== current || !(lines[0]?.depth >= minDepth)) return;
      // Keep the shown best move unless a new one leads twice or is clearly better.
      const top = [...lines].sort((a, b) => a.multipv - b.multipv)[0]?.pv[0] ?? null;
      const persisted = top !== null && top === lastTop;
      lastTop = top;
      shown = steadyLines(shown, lines, persisted);
      draw(shown, undefined);
    })
    .then((result) => {
      if (!result || key !== current) return;
      draw(result.lines, result.bestmove);
      const ms = Math.round(performance.now() - started);
      console.info(`[Vektra] ${fen}: ${result.bestmove} (depth ${result.lines[0]?.depth ?? 0}, ${ms} ms)`);
    });
}

function clear(): void {
  current = '';
  engine.stop();
  layer.clear();
}

Object.assign(window, { vektra: { show, clear } });
console.info('[Vektra] overlay ready');
