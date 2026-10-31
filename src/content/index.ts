import {
  DEFAULT_SETTINGS,
  OPEN_SETTINGS,
  SHOW_HINT,
  loadSettings,
  onSettingsChanged,
  saveSettings,
  type Settings,
} from '../shared/settings';
import { FloatingSettings } from '../ui/floatingSettings';
import { BoardAutoPlayControl } from '../ui/boardAutoPlay';
import { EngineErrorNotice } from '../ui/engineErrorNotice';
import { AutoPlayScheduler } from './autoPlay';
import { readBoardState, watchBoard, type BoardState } from './boardReader';
import { HintController } from './hints';
import { isGameOver, resolveScope, type Scope } from './pageScope';
import { uciToSan } from '../analysis/chessNotation';
import type { AnalysisController } from './analysisController';
import { reportAnalysisLoadFailure, setReloadNotice } from './extensionUpdate';

/**
 * Content script entry: decide whether Vektra may run on this page and, where
 * it may, show engine hints for the position on the board.
 */

let stopWatching: (() => void) | null = null;
let hints: HintController | null = null;
let analysis: AnalysisController | null = null;
let floatingSettings: FloatingSettings | null = null;
let boardAutoPlay: BoardAutoPlayControl | null = null;
let lastScope = '';
let lastBoard: HTMLElement | null = null;
let currentScope: Scope | null = null;
let settings: Settings = DEFAULT_SETTINGS;
let analysisLoad: Promise<void> | null = null;
let analysisGeneration = 0;
const engineErrorNotice = new EngineErrorNotice();
setReloadNotice(engineErrorNotice);
const autoPlay = new AutoPlayScheduler(
  () => settings,
  // Read from the page at every check, not the last scope seen, so a move is
  // never submitted after the page has left a bot game.
  () => resolveScope(location.pathname, document),
  readBoardState,
  (delay) => boardAutoPlay?.setMoveDelay(delay),
);

function needsAnalysis(scope: Scope): boolean {
  return scope.status === 'enabled' &&
    (scope.kind !== 'game' || isGameOver(document));
}

function loadAnalysisController(): void {
  if (!currentScope || !needsAnalysis(currentScope) || analysis || analysisLoad) return;
  const generation = analysisGeneration;
  analysisLoad = import('./analysisController')
    .then(({ AnalysisController: Controller }) => {
      if (generation !== analysisGeneration || !currentScope || !needsAnalysis(currentScope) || !hints) return;
      analysis = new Controller(() => settings);
      hints.analysisLookup = analysis.lookup;
      hints.analysedMove = analysis.moveFor;
      analysis.onAnalysed = () => hints?.refresh();
      const state = readBoardState();
      if (state) analysis.update(state, currentScope.kind);
    })
    .catch((error: unknown) => {
      // Not remembered: the next position change tries again.
      reportAnalysisLoadFailure(error);
    })
    .finally(() => {
      analysisLoad = null;
      if (generation !== analysisGeneration) loadAnalysisController();
    });
}

function clearPendingAutoPlay(): void {
  autoPlay.clear();
}

function updateAutoPlaySetting(enabled: boolean): void {
  settings = { ...settings, autoPlay: enabled };
  if (!enabled) clearPendingAutoPlay();
  hints?.setSettings(settings);
  floatingSettings?.setAutoplayEnabled(enabled);
  const state = readBoardState();
  if (state && boardAutoPlay) {
    boardAutoPlay.update(state.board, enabled, settings.occasionalWeakerMoves);
  }
  void saveSettings({ autoPlay: enabled }).catch((error) => {
    console.error('[Vektra] Could not update autoplay:', error);
  });
}

function updateWeakerMoveSetting(enabled: boolean): void {
  settings = { ...settings, occasionalWeakerMoves: enabled };
  hints?.setSettings(settings);
  const state = readBoardState();
  if (state && boardAutoPlay) boardAutoPlay.update(state.board, settings.autoPlay, enabled);
  void saveSettings({ occasionalWeakerMoves: enabled }).catch((error) => {
    console.error('[Vektra] Could not update weaker-move setting:', error);
  });
}

function stopAutoplay(): void {
  updateAutoPlaySetting(false);
}

function settingsContext(): 'analysis' | 'game' {
  return currentScope?.kind === 'analysis' ||
    currentScope?.kind === 'review' ||
    currentScope?.kind === 'archived'
    ? 'analysis'
    : 'game';
}

function onPosition(state: BoardState | null) {
  // A new board can show up before the URL or page check catches up (chess.com
  // navigates client-side), so the scope is checked first. When it changed,
  // applying it reads the board again if the new page is still enabled.
  const scope = resolveScope(location.pathname, document);
  if (
    location.pathname !== observedPathname ||
    scope.status !== currentScope?.status ||
    scope.kind !== currentScope.kind
  ) {
    evaluate();
    return;
  }
  if (state?.board !== lastBoard) {
    lastBoard = state?.board ?? null;
    autoPlay.resetPosition();
  }
  if (
    state &&
    currentScope?.status === 'enabled' &&
    currentScope.kind === 'game'
  ) {
    boardAutoPlay ??= new BoardAutoPlayControl(updateAutoPlaySetting, updateWeakerMoveSetting);
    boardAutoPlay.update(state.board, settings.autoPlay, settings.occasionalWeakerMoves);
    boardAutoPlay.setThinkTime(null);
    boardAutoPlay.setMoveDelay(null);
    boardAutoPlay.setSuggestion(null, 0);
  } else {
    boardAutoPlay?.destroy();
    boardAutoPlay = null;
  }
  if (!state || !hints || currentScope?.status !== 'enabled') return;
  loadAnalysisController();
  clearPendingAutoPlay();
  console.debug('[Vektra]', state.source, `ply ${state.ply}`, state.flipped ? 'flipped' : '', state.fen);
  analysis?.update(state, currentScope.kind);
  hints.update(state, currentScope.kind);
}

function applyScope(scope: Scope) {
  const key = `${location.pathname}:${scope.status}:${scope.kind}`;
  if (key === lastScope) return;
  clearPendingAutoPlay();
  if (lastScope && !lastScope.startsWith(`${location.pathname}:`)) autoPlay.resetPosition();
  lastScope = key;
  currentScope = scope;
  floatingSettings?.setContext(settingsContext());

  if (scope.status === 'enabled') {
    if (!hints) {
      hints = new HintController();
      hints.setSettings(settings);
      hints.onBestMove = (state, move) => autoPlay.schedule(state, move);
      hints.onEngineError = (message) => engineErrorNotice.show(message, () => hints?.refresh());
      hints.onEngineReady = () => engineErrorNotice.clear();
      hints.onMoveChosen = (state, move, searchTimeMs, lossCp) => {
        boardAutoPlay?.setThinkTime(searchTimeMs);
        boardAutoPlay?.setSuggestion(uciToSan(state.fen, move), lossCp);
      };
    }
    loadAnalysisController();
    if (!stopWatching) stopWatching = watchBoard(onPosition);
    else onPosition(readBoardState());
    return;
  }
  stopWatching?.();
  stopWatching = null;
  hints?.dispose();
  hints = null;
  engineErrorNotice.clear();
  clearPendingAutoPlay();
  boardAutoPlay?.destroy();
  boardAutoPlay = null;
  analysis?.dispose();
  analysis = null;
  analysisGeneration++;
}

function evaluate() {
  observedPathname = location.pathname;
  applyScope(resolveScope(location.pathname, document));
  analysis?.refreshVisibility();
}

// chess.com navigates client-side and shows the game-over state without a page
// load, so the scope is re-checked on URL changes and DOM changes.
let observedPathname = location.pathname;
let pending = false;
new MutationObserver(() => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    evaluate();
  });
}).observe(document.body, { subtree: true, childList: true });
window.addEventListener('popstate', evaluate);
window.setInterval(() => {
  if (location.pathname !== observedPathname) evaluate();
}, 250);
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  lastScope = '';
  evaluate();
  onPosition(readBoardState());
});

onSettingsChanged((next) => {
  settings = next;
  clearPendingAutoPlay();
  hints?.setSettings(next);
  floatingSettings?.setAutoplayEnabled(next.autoPlay);
  const state = readBoardState();
  if (state && boardAutoPlay) {
    boardAutoPlay.update(state.board, next.autoPlay, next.occasionalWeakerMoves);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === SHOW_HINT) hints?.showHint();
  if (msg?.type === OPEN_SETTINGS) {
    floatingSettings ??= new FloatingSettings(
      () => hints?.showHint(),
      stopAutoplay,
      settingsContext(),
    );
    floatingSettings.setContext(settingsContext());
    floatingSettings.setAutoplayEnabled(settings.autoPlay);
    floatingSettings.focus();
    sendResponse({ opened: true });
  }
});

loadSettings()
  .catch(() => DEFAULT_SETTINGS)
  .then((loaded) => {
    settings = loaded;
    hints?.setSettings(loaded);
    floatingSettings?.setAutoplayEnabled(loaded.autoPlay);
    const state = readBoardState();
    if (state && boardAutoPlay) {
      boardAutoPlay.update(state.board, loaded.autoPlay, loaded.occasionalWeakerMoves);
    }
    lastScope = '';
    evaluate();
  });
