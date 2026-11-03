import { Chess } from 'chess.js';
import type { Category } from '@core/analysis/classify';
import { analyzeMove, describeMoveAnalysis, terminalScore, type PositionEval } from '@core/analysis/moveAnalysis';
import { fenFromBoard, moveBetween, onePieceLifted } from '@core/chess/position';
import type { SearchResult } from '@core/engine/search';
import { whitePov, type PvLine } from '@core/engine/uci';
import { UciEngine } from '@core/engine/uciEngine';
import { hintArrows, steadyLines, type Threat } from '@core/hints/hintArrows';
import { buildRequest, buildThreatRequest, buildWeakerRequest } from '@core/hints/hintRequests';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '@core/settings';
import type { Arrow } from '@core/hints/types';
import { GameRecord, START_BOARD } from './gameRecord';
import { NativeLayer, type Badge } from './nativeLayer';

/**
 * The Android app's overlay page. The app calls `vektra.show()` with what it
 * read from the Chess.com board in bot games and `vektra.settings()` with the
 * user's settings; this page runs Stockfish and the shared hint code (core/)
 * and hands what to draw to the app, which paints it (nativeLayer.ts).
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
/** The weaker-move search draws its lines from this depth. */
const WEAKER_DRAW_DEPTH = 5;
/**
 * A move is rated from this depth on, then again as the search goes deeper:
 * bots often reply before a full search ends (as in the extension).
 */
const EARLY_RATING_DEPTH = 4;
/** Final evaluations kept, for rating moves. */
const EVALS_KEPT = 200;

/** A Stockfish worker; `onCrash` gets a new one going if it ever dies. */
function startEngine(name: string, onCrash: () => void): UciEngine {
  const worker = new Worker('engine/stockfish-19-lite-single.js');
  const engine = new UciEngine((command) => worker.postMessage(command));
  worker.onmessage = (event: MessageEvent) => engine.handleLine(String(event.data));
  worker.onerror = (event) => {
    console.error(`[Vektra] the ${name} engine failed (${event.message}); starting it again`);
    worker.terminate();
    onCrash();
  };
  return engine;
}

/** After a crash: the current position is searched again on fresh engines. */
function engineRestarted(): void {
  pondering = null;
  current = '';
  if (lastReading) show(lastReading);
}

/**
 * The main search; the helper runs the quick weaker-move and threat passes
 * and the search ahead beside it. In light mode only the main engine works,
 * one search after another, leaving the phone's fast cores free for drawing.
 */
let main: UciEngine;
let helper: UciEngine;
const startMain = () => {
  main = startEngine('main', () => {
    startMain();
    engineRestarted();
  });
};
const startHelper = () => {
  helper = startEngine('helper', () => {
    startHelper();
    engineRestarted();
  });
};
startMain();
startHelper();
const layer = new NativeLayer();

let settings: Settings = DEFAULT_SETTINGS;
let lastReading: Reading | null = null;
let current = '';
/** The last position on the user's turn, to find the user's move from. */
let userTurnFen: string | null = null;
/** Final evaluations by FEN. */
const evals = new Map<string, PositionEval>();
/** The user's last move and its rating, shown while the piece stays on its square. */
let rated: { badge: Badge; piece: string } | null = null;
/** The position after the user's latest move, the one being rated. */
let ratingFor: string | null = null;
/** The arrows drawn now, so a rating that arrives later can be added to them. */
let shownArrows: Arrow[] = [];

function redraw(): void {
  if (lastReading) layer.draw(shownArrows, lastReading.flipped, visibleBadge());
}

function remember(fen: string, lines: PvLine[]): void {
  const turn = fen.split(' ')[1] as 'w' | 'b';
  const score = terminalScore(fen) ?? (lines[0] ? whitePov(lines[0].score, turn) : null);
  if (!score) return;
  evals.set(fen, { fen, score, lines });
  if (evals.size > EVALS_KEPT) evals.delete(evals.keys().next().value!);
}

/** The piece (FEN letter) on a square of a placement, or "". */
function pieceAt(board: string, square: string): string {
  const row = board.split('/')[8 - Number(square[1])] ?? '';
  let file = 0;
  for (const c of row) {
    if (c >= '1' && c <= '8') file += Number(c);
    else if (file++ === square.charCodeAt(0) - 97) return c;
  }
  return '';
}

/** Rate the user's move from `beforeFen` to `fen`, once both are evaluated. */
async function rateMove(beforeFen: string, fen: string): Promise<void> {
  const before = evals.get(beforeFen);
  const after = evals.get(fen);
  const move = moveBetween(beforeFen, fen.split(' ')[0]);
  if (!before || !after || !move) return;
  // The move list on screen is too short to replay the game, so only the
  // position reached says whether the move was still in the opening book.
  const { openingName } = await import('@core/analysis/openings');
  const analysis = analyzeMove(before, after, { ply: 0, san: move.san, uci: move.uci }, { book: openingName(fen) !== undefined });
  // The user has moved again since: this rating is out of date.
  if (ratingFor !== fen) return;
  if (rated?.badge.category !== analysis.category) console.info(`[Vektra] your move ${move.san}: ${analysis.category}`);
  rated = {
    badge: { square: move.uci.slice(2, 4), category: analysis.category as Category, title: describeMoveAnalysis(analysis) },
    piece: pieceAt(fen.split(' ')[0], move.uci.slice(2, 4)),
  };
  redraw();
}

function visibleBadge(): Badge | null {
  if (!rated || !lastReading || !settings.liveRatings) return null;
  return pieceAt(lastReading.board, rated.badge.square) === rated.piece ? rated.badge : null;
}

/** Bot replies whose positions are searched ahead while the bot thinks (as in the extension). */
const PONDER_REPLIES = 2;
/** Searching ahead starts once the bot's position is searched this deep. */
const PONDER_FROM_DEPTH = 8;
/** Searches done ahead, by FEN. */
const PONDER_KEPT = 20;

/**
 * A search of a position the user may get next, run on the helper engine
 * while the bot thinks. If the bot plays into it, the user's hints continue
 * from it instead of starting again.
 */
interface Pondering {
  fen: string;
  engine: UciEngine;
  latest: PvLine[];
  onUpdate: ((lines: PvLine[]) => void) | null;
  result: Promise<SearchResult | null>;
}
let pondering: Pondering | null = null;
const pondered = new Map<string, SearchResult>();

/** The FEN the user gets after the bot plays `reply`, as show() will build it from the board. */
function fenAfterReply(fen: string, reply: string, user: 'w' | 'b'): string | null {
  try {
    const chess = new Chess(fen);
    chess.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
    return fenFromBoard(chess.fen().split(' ')[0], user);
  } catch {
    return null;
  }
}

/** Search the positions after the bot's likeliest replies, one after the other. */
async function ponder(fen: string, lines: PvLine[], user: 'w' | 'b', stale: () => boolean): Promise<void> {
  const replies = [...lines]
    .sort((a, b) => a.multipv - b.multipv)
    .map((line) => line.pv[0])
    .filter((move): move is string => !!move)
    .slice(0, PONDER_REPLIES);
  for (const reply of replies) {
    const next = fenAfterReply(fen, reply, user);
    if (!next || pondered.has(next) || stale()) continue;
    // In light mode the one engine searches ahead once the bot's position is done.
    const engine = settings.lightMode ? main : helper;
    const job: Pondering = { fen: next, engine, latest: [], onUpdate: null, result: Promise.resolve(null) };
    job.result = engine.analyze(buildRequest(next, settings, null), (update) => {
      job.latest = update;
      job.onUpdate?.(update);
    });
    pondering = job;
    const result = await job.result;
    if (pondering === job) pondering = null;
    if (!result) return;
    pondered.set(next, result);
    if (pondered.size > PONDER_KEPT) pondered.delete(pondered.keys().next().value!);
  }
}

/** Whose turn it is: from the board when it is one move on from the last position, else from the move list. */
function turnOf(reading: Reading): 'w' | 'b' | null {
  if (lastFen) {
    const [lastBoard, lastTurn] = lastFen.split(' ');
    // Nothing moved: the move list may still be catching up.
    if (reading.board === lastBoard) return lastTurn as 'w' | 'b';
    // One legal move on: the turn passed, before the move list shows it.
    if (moveBetween(lastFen, reading.board)) return lastTurn === 'w' ? 'b' : 'w';
  }
  return reading.turn ?? (reading.board === START_BOARD ? 'w' : null);
}

/** The position last shown, with whose turn it was. */
let lastFen: string | null = null;

/** The bot game being played, kept by the app for a review afterwards. */
const game = new GameRecord();

function record(fen: string, flipped: boolean): void {
  if (game.add(fen, flipped) && game.sans.length) {
    window.VektraNative?.game?.(JSON.stringify({ sans: game.sans, flipped: game.flipped }));
  }
}

function show(reading: Reading): void {
  if (!settings.enabled) {
    clear();
    lastReading = reading;
    return;
  }
  // The user is dragging a piece (its square reads as empty): not a position yet.
  if (lastFen && onePieceLifted(lastFen.split(' ')[0], reading.board)) return;
  const turn = turnOf(reading);
  const fen = turn ? fenFromBoard(reading.board, turn) : null;
  // An impossible board was read mid-animation, or the turn is unknown: keep what is shown.
  if (!fen) return;
  const key = `${fen} ${reading.flipped}`;
  if (key === current) return;
  current = key;
  lastReading = reading;
  lastFen = fen;
  record(fen, reading.flipped);
  // A search done ahead for exactly this position goes on; everything else stops.
  const continued = pondering && pondering.fen === fen ? pondering : null;
  if (continued?.engine !== main) main.stop();
  if (continued?.engine !== helper) helper.stop();
  if (!continued) pondering = null;
  layer.clearArrows();
  shownArrows = [];
  const user = reading.flipped ? 'b' : 'w';
  const stale = () => key !== current;

  if (turn !== user) {
    // The bot's turn: no hints. Search the position quietly, to rate the
    // user's move and to search ahead the bot's likeliest replies.
    const beforeFen = userTurnFen;
    userTurnFen = null;
    // A new move of the user's: the previous rating no longer applies.
    if (beforeFen) {
      rated = null;
      ratingFor = fen;
    }
    redraw();
    let ponderStarted = false;
    let ratedEarly = false;
    const use = (lines: PvLine[], final: boolean) => {
      if (stale()) return;
      // The eval strip follows the game on the bot's turn too.
      if (lines[0]?.depth >= MIN_DRAW_DEPTH) layer.eval(whitePov(lines[0].score, fen.split(' ')[1] as 'w' | 'b'), reading.flipped);
      // Rated twice: as soon as the search is deep enough (bots reply fast),
      // and when it ends. Rating builds the reason for a bad move, which is
      // slow enough to hold up a move Chess.com announces meanwhile.
      if (beforeFen && settings.liveRatings && lines[0]?.depth >= EARLY_RATING_DEPTH && (final || !ratedEarly)) {
        ratedEarly = true;
        remember(fen, lines);
        void rateMove(beforeFen, fen);
      }
      // Beside this search on the helper; in light mode after it, on the one engine.
      if (!ponderStarted && !settings.lightMode && lines[0]?.depth >= PONDER_FROM_DEPTH) {
        ponderStarted = true;
        void ponder(fen, lines, user, stale);
      }
    };
    void main.analyze(buildRequest(fen, settings, null), (lines) => use(lines, false)).then((result) => {
      if (!result) return;
      use(result.lines, true);
      if (settings.lightMode && !stale()) void ponder(fen, result.lines, user, stale);
    });
    return;
  }

  userTurnFen = fen;
  const minDepth = Math.min(MIN_DRAW_DEPTH, settings.searchMode === 'depth' ? settings.depth : 1);
  const started = performance.now();
  let lines: PvLine[] = [];
  let weakerLines: PvLine[] = [];
  let bestmove: string | null | undefined;
  let threat: Threat | null = null;
  let lastTop: string | null = null;
  let firstDrawLogged = false;

  const draw = () => {
    if (stale()) return;
    if (!firstDrawLogged && lines.length) {
      firstDrawLogged = true;
      console.info(`[Vektra] first arrows after ${Math.round(performance.now() - started)} ms (depth ${lines[0].depth})`);
    }
    shownArrows = hintArrows({
      kind: 'game',
      fen,
      settings,
      lines,
      weakerLines,
      bestmove,
      moveChoice: null,
      threat,
      showMoves: true,
    });
    redraw();
    if (lines[0]) layer.eval(whitePov(lines[0].score, turn), reading.flipped);
  };
  const onUpdate = (update: PvLine[]) => {
    if (stale() || !(update[0]?.depth >= minDepth)) return;
    // Keep the shown best move unless a new one leads twice or is clearly better.
    const top = [...update].sort((a, b) => a.multipv - b.multipv)[0]?.pv[0] ?? null;
    const persisted = top !== null && top === lastTop;
    lastTop = top;
    lines = steadyLines(lines, update, persisted);
    // The user may move before the search ends; their move is rated from this.
    remember(fen, update);
    draw();
  };
  const onResult = (result: SearchResult | null, source: string) => {
    if (!result || stale()) return;
    lines = result.lines;
    bestmove = result.bestmove;
    remember(fen, result.lines);
    draw();
    const ms = Math.round(performance.now() - started);
    console.info(`[Vektra] ${fen}: ${result.bestmove} (depth ${result.lines[0]?.depth ?? 0}, ${ms} ms, ${source})`);
  };

  // The main search: done ahead already, going on from a search ahead, or new.
  const done = pondered.get(fen);
  let mainSearch: Promise<unknown> = Promise.resolve();
  if (done) {
    onResult(done, 'searched ahead');
  } else if (continued) {
    continued.onUpdate = onUpdate;
    if (continued.latest.length) onUpdate(continued.latest);
    mainSearch = continued.result.then((result) => onResult(result, 'continued from the search ahead'));
  } else {
    mainSearch = main.analyze(buildRequest(fen, settings, null), onUpdate).then((result) => onResult(result, 'new search'));
  }
  // The quick passes run beside the main search on the other engine, or in
  // light mode after it, on the same one.
  const quick: UciEngine = settings.lightMode ? (continued?.engine ?? main) : continued?.engine === helper ? main : helper;

  // The quick passes, one after the other.
  void (async () => {
    if (settings.lightMode) await mainSearch;
    if (stale()) return;
    if (settings.occasionalWeakerMoves) {
      const weaker = await quick.analyze(buildWeakerRequest(fen, settings, null), (update) => {
        if (stale() || !(update[0]?.depth >= WEAKER_DRAW_DEPTH)) return;
        weakerLines = update;
        draw();
      });
      if (!weaker || stale()) return;
      weakerLines = weaker.lines;
      draw();
    }
    const threatRequest = settings.showThreats ? buildThreatRequest(fen, settings) : null;
    if (threatRequest) {
      const result = await quick.analyze(threatRequest);
      const line = result?.lines[0];
      if (!result?.bestmove || !line || stale()) return;
      threat = { move: result.bestmove, score: line.score };
      draw();
    }
  })();
}

/**
 * A move Chess.com announced for screen readers, the moment it was played
 * and before its board can be read: applied to the position shown. The board
 * reads that follow check it (show() ignores the same position again, and a
 * different board wins).
 *
 * Announcements are worded differently for captures and other moves, so the
 * app only passes the mover's colour, its piece and the squares mentioned;
 * the move used is the one legal move that fits them.
 */
function played(move: { squares: string[]; color: 'w' | 'b' | null; piece: string }): void {
  const skip = (why: string) => console.info(`[Vektra] announced ${move.color ?? '?'} ${move.piece} ${move.squares.join(' ')} not used: ${why}`);
  if (!settings.enabled) return;
  if (!lastFen || !lastReading) return skip('no position yet');
  // Captures name no colour: then it is the side to move.
  if (move.color && lastFen.split(' ')[1] !== move.color) return skip(`not ${move.color}'s turn in ${lastFen}`);
  const chess = new Chess(lastFen);
  // To a square mentioned, from another one mentioned if there is one, by the
  // piece named; a promotion is taken to be a queen until the board says otherwise.
  const fits = chess.moves({ verbose: true }).filter(
    (m) =>
      move.squares.includes(m.to) &&
      (move.squares.length < 2 || move.squares.includes(m.from)) &&
      m.piece === move.piece &&
      (!m.promotion || m.promotion === 'q'),
  );
  if (fits.length !== 1) return skip(`${fits.length} legal moves fit in ${lastFen}`);
  chess.move(fits[0]);
  show({ board: chess.fen().split(' ')[0], turn: chess.turn(), flipped: lastReading.flipped });
}

function clear(): void {
  current = '';
  lastFen = null;
  main.stop();
  helper.stop();
  pondering = null;
  layer.clear();
}

/** The user's settings from the app; anything missing keeps its default. */
function applySettings(patch: Partial<Settings>): void {
  // No autoplay on Android: weaker moves are only shown, never played.
  settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...patch, autoPlay: false, searchMode: 'depth' });
  if (lastReading) {
    current = '';
    show(lastReading);
  }
}

Object.assign(window, { vektra: { show, clear, played, settings: applySettings } });
console.info('[Vektra] overlay ready');
