import { Chess } from 'chess.js';
import { analyzeGame } from '@core/analysis/gameAnalysis';
import { UciEngine } from '@core/engine/uciEngine';
import { DEFAULT_SETTINGS } from '@core/settings';
import { AnalysisPanel } from '@ext/ui/analysisPanel';

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
      review(g.pgn!);
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

function review(pgn: string): void {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const sans = chess.history();
  const p = new AnalysisPanel({
    onAnalyze: () => void run(),
    onCancel: () => {
      stopEngines();
      p.showIdle(sans.length);
    },
    onSelectPly: (ply) => p.setCurrentPly(ply),
  });
  panel = p;

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
    const analysis = await analyzeGame(sans, engines, {
      depth: DEFAULT_SETTINGS.analysisDepth,
      onProgress: (done, total) => !signal.aborted && p.showProgress(done, total),
      signal,
    });
    if (signal.aborted || crashed) return;
    stopEngines();
    if (analysis) p.showResult(analysis, null);
    else p.showIdle(sans.length, false, 'The analysis failed. Try again.');
  };
  void run();
}

window.addEventListener('popstate', () => {
  stopEngines();
  panel?.destroy();
  panel = null;
});
