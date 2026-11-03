import { Chess } from 'chess.js';
import { analyzeGame, describeMoveAnalysis, type GameAnalysis } from '@core/analysis/gameAnalysis';
import { UciEngine } from '@core/engine/uciEngine';
import { arrowScoreLabel } from '@core/hints/hintArrows';
import type { Arrow } from '@core/hints/types';
import { DEFAULT_SETTINGS, sanitizeSettings } from '@core/settings';
import { AnalysisPanel, LEGEND } from '@ext/ui/analysisPanel';
import { BoardOverlay } from '@ext/ui/overlay';
import { pieceSvg } from './pieces';

/**
 * The Android app's review screen (ReviewActivity): finished games from
 * Chess.com's public archive, no login, analysed and shown with the
 * extension's code. Never a game in progress.
 */

/** A game in a monthly archive, as api.chess.com returns it (the fields used). */
interface ArchiveGame {
  pgn?: string;
  rules: string;
  time_class: string;
  end_time: number;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

/** The app's side of the page (ReviewActivity.kt); missing in a browser. */
const app = (window as unknown as { VektraReview?: { settings(): string; lastGame(): string; close(): void } }).VektraReview;
const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(app?.settings() ?? '{}') });

const USERNAME_KEY = 'reviewUsername';
const LINE_KEY = 'reviewLine';
/** Two engines side by side: the phone's two fast cores. */
const ENGINES = 2;
const FILES = 'abcdefgh';

/** The legend for this board: the extension's, with the marks drawn here. */
const APP_LEGEND: [string, string][] = [
  ['Yellow squares', 'The move just played: where the piece came from and went to.'],
  ['Badge on a square', 'How that move was rated, Brilliant to Blunder.'],
  ['Blue arrow', 'The better move, when the move played was not the best or a book move.'],
  ['Line', "Shows the engine's best line from the position shown: 1 is the move to play, 2 the reply, 3 the move after. The score on arrow 1 is from White's side: +1.5 means White is 1.5 pawns better, M3 mate in 3."],
  ...LEGEND.filter(([term]) => ['Eval graph', 'Accuracy', 'Game rating', 'Phases'].includes(term)).map(
    ([term, text]): [string, string] => [term, text.replace('Click it', 'Tap it')],
  ),
];

// shortcut: the panel keeps folded/dragged state in chrome.storage; nothing is kept here, upgrade if it matters full-screen.
Object.assign(globalThis, { chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } } });

const form = document.getElementById('search') as HTMLFormElement;
const input = document.getElementById('username') as HTMLInputElement;
const status = document.getElementById('status')!;
const list = document.getElementById('games')!;
const title = document.querySelector('#title b')!;
const subtitle = document.querySelector('#title small')!;
const viewer = document.getElementById('viewer')!;
const board = document.getElementById('board')!;
const moveText = document.getElementById('move')!;
const lineButton = document.getElementById('line')!;
const overlay = new BoardOverlay(board);

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

input.value = stored(USERNAME_KEY) ?? '';
let showLine = stored(LINE_KEY) === 'true';
lineButton.setAttribute('aria-pressed', String(showLine));

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (response.status === 404) throw new Error('not found');
  if (!response.ok) throw new Error(`Chess.com answered ${response.status}`);
  return response.json();
}

/** A month of games (an archive URL), newest first. */
async function loadMonth(url: string): Promise<ArchiveGame[]> {
  const { games } = (await getJson(url)) as { games: ArchiveGame[] };
  return games.filter((g) => g.rules === 'chess' && g.pgn).sort((a, b) => b.end_time - a.end_time);
}

function result(g: ArchiveGame): string {
  if (g.white.result === 'win') return '1-0';
  if (g.black.result === 'win') return '0-1';
  return '½-½';
}

/** One row of the game list: your colour, the opponent, how it ended for you. */
function gameCard(g: ArchiveGame, username: string): HTMLButtonElement {
  const black = g.black.username.toLowerCase() === username.toLowerCase();
  const [me, them] = black ? [g.black, g.white] : [g.white, g.black];
  const outcome = me.result === 'win' ? 'won' : them.result === 'win' ? 'lost' : 'drawn';
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'game';
  const side = document.createElement('span');
  side.className = 'side';
  side.style.background = black ? '#1b1b1b' : '#f4f1ea';
  side.title = black ? 'You played Black' : 'You played White';
  const who = document.createElement('span');
  who.className = 'who';
  const name = document.createElement('b');
  name.textContent = `vs ${them.username} (${them.rating})`;
  const details = document.createElement('small');
  details.textContent = `${g.time_class}, ${new Date(g.end_time * 1000).toLocaleDateString()}`;
  who.append(name, details);
  const badge = document.createElement('span');
  badge.className = `result ${outcome}`;
  badge.textContent = { won: 'Won', lost: 'Lost', drawn: 'Draw' }[outcome];
  card.append(side, who, badge);
  card.addEventListener('click', () => {
    // Back (the bar's arrow or the phone's) comes back to the list.
    history.pushState({ review: true }, '');
    title.textContent = `${g.white.username} – ${g.black.username}`;
    subtitle.textContent = `${result(g)}, ${g.time_class}`;
    const chess = new Chess();
    chess.loadPgn(g.pgn!);
    review(chess, black);
  });
  return card;
}

/** The player's monthly archives, oldest first, and how many of the newest are loaded. */
let archives: string[] = [];
let shown = 0;
/** Games loaded but not listed yet: they are listed a page at a time, as a busy player has thousands a month. */
let pending: ArchiveGame[] = [];
const PAGE = 50;

function errorText(e: unknown, username: string): string {
  return (e as Error).message === 'not found'
    ? `No Chess.com player named ${username}.`
    : `Couldn't load the games: ${(e as Error).message}.`;
}

/**
 * Lists the next page of games. When the loaded ones run out, older months
 * are loaded first (`months` of them, then one at a time).
 */
async function showMore(username: string, months = 1): Promise<void> {
  list.querySelector('.older')?.remove();
  while (!pending.length && shown < archives.length) {
    const urls = archives.slice(Math.max(0, archives.length - shown - months), archives.length - shown).reverse();
    shown += urls.length;
    pending = (await Promise.all(urls.map(loadMonth))).flat();
  }
  for (const g of pending.splice(0, PAGE)) {
    const li = document.createElement('li');
    li.append(gameCard(g, username));
    list.append(li);
  }
  if (!list.children.length) status.textContent = 'No finished games found.';
  if (!pending.length && shown >= archives.length) return;
  const older = document.createElement('li');
  older.className = 'older';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = pending.length ? 'Show more games' : 'Load older games';
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Loading…';
    showMore(username).catch((e) => {
      button.disabled = false;
      button.textContent = `Load older games (${errorText(e, username)})`;
    });
  });
  older.append(button);
  list.append(older);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = input.value.trim();
  if (!username) return;
  store(USERNAME_KEY, username);
  status.textContent = 'Loading games…';
  list.replaceChildren();
  try {
    ({ archives } = (await getJson(
      `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`,
    )) as { archives: string[] });
    shown = 0;
    pending = [];
    status.textContent = 'Pick a game to review.';
    await showMore(username, 2);
  } catch (e) {
    status.textContent = errorText(e, username);
  }
});

let panel: AnalysisPanel | null = null;
let workers: Worker[] = [];
let abort: AbortController | null = null;
/** Moves to the position `step` plies away; set by review() for the game shown. */
let go: (step: number) => void = () => {};
/** Draws the board again (the line was switched on or off). */
let redraw = () => {};

document.getElementById('back')!.addEventListener('click', () => go(-1));
document.getElementById('forward')!.addEventListener('click', () => go(1));
lineButton.addEventListener('click', () => {
  showLine = !showLine;
  store(LINE_KEY, String(showLine));
  lineButton.setAttribute('aria-pressed', String(showLine));
  redraw();
});
document.getElementById('close')!.addEventListener('click', () => {
  if (!viewer.hidden) history.back();
  else app?.close();
});

function stopEngines(): void {
  abort?.abort();
  abort = null;
  workers.forEach((w) => w.terminate());
  workers = [];
}

/** The position of a FEN, from the user's side, with the move just played (`moved` squares) marked. */
function drawBoard(fen: string, flipped: boolean, moved: string[]): void {
  const rows = fen.split(' ')[0].split('/').map((row) => row.replace(/\d/g, (n) => '.'.repeat(Number(n))));
  const squares: HTMLDivElement[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const file = flipped ? 7 - c : c;
      const rank = flipped ? r + 1 : 8 - r;
      const square = document.createElement('div');
      square.className = (file + rank) % 2 === 0 ? 'light' : 'dark';
      if (moved.includes(FILES[file] + rank)) square.classList.add('moved');
      if (c === 0) square.dataset.rank = String(rank);
      if (r === 7) square.dataset.file = FILES[file];
      const piece = rows[8 - rank][file];
      if (piece !== '.') square.innerHTML = pieceSvg(piece);
      squares.push(square);
    }
  }
  // The overlay's layers stay; only the squares are replaced.
  board.querySelectorAll(':scope > div').forEach((d) => d.remove());
  board.append(...squares);
}

/** Opens a game (its moves played on `chess`) on the board, from the user's side, and analyses it. */
function review(chess: Chess, flipped: boolean): void {
  const moves = chess.history({ verbose: true });
  const sans = moves.map((m) => m.san);
  const fens = [moves[0]?.before ?? chess.fen(), ...moves.map((m) => m.after)];
  let ply = 0;
  let analysis: GameAnalysis | null = null;

  /**
   * The board at `ply`, the move that led there marked. Once analysed: its
   * rating, the better move when there was one, and, if switched on, the
   * engine's line from here.
   */
  const show = () => {
    const last = moves[ply - 1];
    drawBoard(fens[ply], flipped, last ? [last.from, last.to] : []);
    const move = last ? `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '...'} ${last.san}` : 'Start';
    moveText.textContent = `${move}  (${ply}/${sans.length})`;
    const position = analysis?.positions[ply];
    if (!analysis || !position) return overlay.clear();
    const played = analysis.moves[ply - 1];
    const arrows: Arrow[] = [];
    // As the panel says it: "Best was ..." for anything but the best or a book move.
    if (played?.bestMove && played.bestMove !== played.uci && played.category !== 'best' && played.category !== 'book') {
      arrows.push({ move: played.bestMove, rank: 0 });
    }
    if (showLine) {
      const label = arrowScoreLabel(position.score);
      const line = position.lines[0]?.pv.slice(0, 3) ?? [];
      arrows.push(...line.map((m, i) => ({ move: m, rank: i, step: i + 1, ...(i === 0 ? { label } : {}) })));
    }
    overlay.draw(board, arrows, flipped);
    if (played) {
      overlay.drawBadge(board, { square: played.uci.slice(2, 4), category: played.category, title: describeMoveAnalysis(played) }, flipped);
    }
  };
  const select = (next: number) => {
    ply = Math.max(0, Math.min(sans.length, next));
    show();
    p.setCurrentPly(ply || null);
  };
  go = (step) => select(ply + step);
  redraw = show;

  const p = new AnalysisPanel({
    onAnalyze: () => void run(),
    onCancel: () => {
      stopEngines();
      p.showIdle(sans.length);
    },
    onSelectPly: select,
  });
  p.legendItems = APP_LEGEND;
  panel = p;
  viewer.hidden = false;
  show();

  const run = async () => {
    stopEngines();
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
        p.showIdle(sans.length, false, 'The engine stopped. Try again.');
      };
      workers.push(worker);
      return engine;
    });
    p.showProgress(0, sans.length + 1);
    analysis = null;
    show();
    const result = await analyzeGame(sans, engines, {
      depth: settings.analysisDepth,
      onProgress: (done, total) => !signal.aborted && p.showProgress(done, total),
      signal,
    });
    if (signal.aborted || crashed) return;
    stopEngines();
    analysis = result;
    show();
    if (result) p.showResult(result, ply || null);
    else p.showIdle(sans.length, false, 'The analysis failed. Try again.');
  };
  void run();
}

/** The last bot game, recorded by the overlay page as it was played (ReviewActivity opens review.html#last). */
function reviewLastGame(): void {
  try {
    const last = JSON.parse(app?.lastGame() || 'null') as { sans: string[]; flipped: boolean } | null;
    if (!last?.sans.length) throw new Error('no game');
    const chess = new Chess();
    for (const san of last.sans) chess.move(san);
    history.pushState({ review: true }, '');
    title.textContent = 'Your last bot game';
    subtitle.textContent = `${Math.ceil(last.sans.length / 2)} moves, you played ${last.flipped ? 'Black' : 'White'}`;
    review(chess, last.flipped);
  } catch {
    status.textContent = "There's no bot game to review yet: play one from its first move with Vektra on.";
  }
}
if (location.hash === '#last') reviewLastGame();

window.addEventListener('popstate', () => {
  stopEngines();
  panel?.destroy();
  panel = null;
  viewer.hidden = true;
  overlay.clear();
  title.textContent = 'Review games';
  subtitle.textContent = 'Finished games from Chess.com';
});
