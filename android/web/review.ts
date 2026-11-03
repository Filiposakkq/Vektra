import { Chess } from 'chess.js';
import { analyzeGame, describeMoveAnalysis, type GameAnalysis } from '@core/analysis/gameAnalysis';
import { UciEngine } from '@core/engine/uciEngine';
import { arrowScoreLabel } from '@core/hints/hintArrows';
import { DEFAULT_SETTINGS } from '@core/settings';
import { AnalysisPanel } from '@ext/ui/analysisPanel';
import { BoardOverlay } from '@ext/ui/overlay';

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
  white: { username: string; result: string };
  black: { username: string; result: string };
}

const USERNAME_KEY = 'reviewUsername';
/** Games listed: the newest from the last two months. */
const LISTED = 50;
/** Two engines side by side: the phone's two fast cores. */
const ENGINES = 2;

// shortcut: the panel keeps folded/dragged state in chrome.storage; nothing is kept here, upgrade if it matters full-screen.
Object.assign(globalThis, { chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } } });

const form = document.getElementById('search') as HTMLFormElement;
const input = document.getElementById('username') as HTMLInputElement;
const status = document.getElementById('status')!;
const list = document.getElementById('games')!;

try {
  input.value = localStorage.getItem(USERNAME_KEY) ?? '';
} catch {}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (response.status === 404) throw new Error('not found');
  if (!response.ok) throw new Error(`Chess.com answered ${response.status}`);
  return response.json();
}

async function loadGames(username: string): Promise<ArchiveGame[]> {
  const { archives } = (await getJson(
    `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`,
  )) as { archives: string[] };
  const months = await Promise.all(archives.slice(-2).map((url) => getJson(url) as Promise<{ games: ArchiveGame[] }>));
  return months
    .flatMap((m) => m.games)
    .filter((g) => g.rules === 'chess' && g.pgn)
    .sort((a, b) => b.end_time - a.end_time)
    .slice(0, LISTED);
}

function result(g: ArchiveGame): string {
  if (g.white.result === 'win') return '1-0';
  if (g.black.result === 'win') return '0-1';
  return '½-½';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = input.value.trim();
  if (!username) return;
  try {
    localStorage.setItem(USERNAME_KEY, username);
  } catch {}
  status.textContent = 'Loading games…';
  list.replaceChildren();
  let games: ArchiveGame[];
  try {
    games = await loadGames(username);
  } catch (e) {
    status.textContent = (e as Error).message === 'not found'
      ? `No Chess.com player named ${username}.`
      : `Couldn't load the games: ${(e as Error).message}.`;
    return;
  }
  status.textContent = games.length ? 'Pick a game to review.' : 'No finished games in the last two months.';
  for (const g of games) {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = `${g.white.username} – ${g.black.username}  ${result(g)}`;
    const details = document.createElement('small');
    details.textContent = `${g.time_class}, ${new Date(g.end_time * 1000).toLocaleDateString()}`;
    item.append(details);
    item.addEventListener('click', () => {
      // The phone's back button comes back to the list (ReviewActivity goes back in the page's history).
      history.pushState({ review: true }, '');
      review(g.pgn!, g.black.username.toLowerCase() === username.toLowerCase());
    });
    const li = document.createElement('li');
    li.append(item);
    list.append(li);
  }
});

let panel: AnalysisPanel | null = null;
let workers: Worker[] = [];
let abort: AbortController | null = null;

function stopEngines(): void {
  abort?.abort();
  abort = null;
  workers.forEach((w) => w.terminate());
  workers = [];
}

const viewer = document.getElementById('viewer')!;
const board = document.getElementById('board')!;
const moveText = document.getElementById('move')!;
const overlay = new BoardOverlay(board);
/** Filled glyphs for both sides (coloured by CSS); U+FE0E asks for text, not emoji. */
const GLYPHS: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
/** Moves to the position after `ply`; set by review() for the game shown. */
let go: (ply: number) => void = () => {};

document.getElementById('back')!.addEventListener('click', () => go(-1));
document.getElementById('forward')!.addEventListener('click', () => go(1));

/** The pieces of a FEN on the board, rank 8 first (h1 first when flipped). */
function drawPieces(fen: string, flipped: boolean): void {
  const squares: HTMLDivElement[] = [];
  for (const row of fen.split(' ')[0].split('/')) {
    for (const c of row) {
      if (/\d/.test(c)) {
        for (let i = 0; i < Number(c); i++) squares.push(document.createElement('div'));
        continue;
      }
      const square = document.createElement('div');
      square.className = c === c.toUpperCase() ? 'w' : 'b';
      square.textContent = `${GLYPHS[c.toLowerCase()]}︎`;
      squares.push(square);
    }
  }
  // The overlay's layers stay; only the squares are replaced.
  board.querySelectorAll(':scope > div').forEach((d) => d.remove());
  board.append(...(flipped ? squares.reverse() : squares));
}

function review(pgn: string, flipped: boolean): void {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const moves = chess.history({ verbose: true });
  const sans = moves.map((m) => m.san);
  const fens = [moves[0]?.before ?? chess.fen(), ...moves.map((m) => m.after)];
  let ply = 0;
  let analysis: GameAnalysis | null = null;

  /** The board at `ply`: with the analysis, the engine's best line from there and the rating of the move played. */
  const show = () => {
    drawPieces(fens[ply], flipped);
    const move = ply ? `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '...'} ${sans[ply - 1]}` : 'Start';
    moveText.textContent = `${move}  (${ply}/${sans.length})`;
    const position = analysis?.positions[ply];
    if (!analysis || !position) return overlay.clear();
    const line = position.lines[0]?.pv.slice(0, 3) ?? [];
    const label = arrowScoreLabel(position.score);
    overlay.draw(board, line.map((m, i) => ({ move: m, rank: i, step: i + 1, ...(i === 0 ? { label } : {}) })), flipped);
    const played = analysis.moves[ply - 1];
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

  const p = new AnalysisPanel({
    onAnalyze: () => void run(),
    onCancel: () => {
      stopEngines();
      p.showIdle(sans.length);
    },
    onSelectPly: select,
  });
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
      depth: DEFAULT_SETTINGS.analysisDepth,
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

window.addEventListener('popstate', () => {
  stopEngines();
  panel?.destroy();
  panel = null;
  viewer.hidden = true;
  overlay.clear();
});
