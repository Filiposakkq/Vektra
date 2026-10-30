import {
  analyzeGame,
  classifyGame,
  gameOpening,
  summarize,
  type GameAnalysis,
  type MoveAnalysis,
  type PositionEval,
} from '../analysis/gameAnalysis';
import {
  cacheKey,
  engineLabel,
  findCached,
  profileFor,
  usedEngine,
  withEntry,
  type EngineKind,
} from '../analysis/analysisCache';
import { replay } from './fen';
import { downloadJson } from '../analysis/export';
import { downloadPdf } from '../analysis/pdfExport';
import { EngineClient } from '../engine/client';
import type { Settings } from '../shared/settings';
import { AnalysisPanel } from '../ui/analysisPanel';
import { applyMoveBadges, clearMoveBadges } from '../ui/moveBadges';
import type { BoardState } from './boardReader';
import { findMoveList } from './moveList';
import { isGameOver, isLiveGamePath, type PageKind } from './pageScope';
import { SELECTORS } from './selectors';

/** True if `prefix` is the start of `sans`. */
function isPrefix(prefix: readonly string[], sans: readonly string[]): boolean {
  return prefix.length <= sans.length && prefix.every((s, i) => s === sans[i]);
}

/**
 * Full-game analysis: runs the engine over the game on request, then shows
 * badges on the move list, the summary panel, and the engine line for the
 * position on the board.
 */
/**
 * Finished analyses kept in storage.local, so reopening a game is instant
 * (see analysisCache.ts for when a saved one is reused).
 */
const CACHE_KEY = 'analysisCache';

/**
 * How many engines analyse a game side by side. Lite workers are small, so
 * up to four; the full engine is ~100 MB per worker, so two.
 */
function poolSize(full: boolean): number {
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(full ? 2 : 4, cores - 1));
}

export class AnalysisController {
  private pool: EngineClient[] = [];
  /** Moves rated so far while an analysis is running. */
  private partial: (MoveAnalysis | undefined)[] | null = null;
  private kind: PageKind = 'none';
  private cacheChecked = '';
  private panel: AnalysisPanel;
  private analysis: GameAnalysis | null = null;
  private abort: AbortController | null = null;
  private state: BoardState | null = null;
  private listObserver: MutationObserver | null = null;
  private observedList: Element | null = null;

  constructor(private getSettings: () => Settings) {
    this.panel = new AnalysisPanel({
      onAnalyze: () => void this.run(),
      onCancel: () => this.cancel(),
      onExport: () => this.analysis && downloadJson(this.analysis),
      onExportPdf: () => {
        if (this.analysis) downloadPdf(this.analysis).catch((e) => console.warn('[Vektra] PDF export failed:', e));
      },
      onSelectPly: (ply) => this.goToPly(ply),
    });
  }

  /** The analysed move that led to the position on the board, if any. */
  moveFor = (state: BoardState): MoveAnalysis | undefined =>
    this.lookup(state) && state.ply > 0 ? this.analysis?.moves[state.ply - 1] : undefined;

  /** Analysis of the position on the board, if it is in the analysed game. */
  lookup = (state: BoardState): PositionEval | undefined => {
    const a = this.analysis;
    if (!a || state.inVariation || !isPrefix(a.sans, state.sans)) return undefined;
    const pos = a.positions[state.ply];
    return pos?.fen === state.fen ? pos : undefined;
  };

  update(state: BoardState, kind: PageKind = this.kind): void {
    this.state = state;
    this.kind = kind;
    this.panel.ensureMounted();
    this.refreshVisibility();
    if (this.abort) return; // running; progress is on the panel
    const a = this.analysis;
    if (!a) {
      this.panel.showIdle(state.sans.length);
      void this.loadCached(state.sans);
      return;
    }
    if (!isPrefix(a.sans, state.sans)) {
      this.analysis = null;
      clearMoveBadges();
      this.panel.showIdle(state.sans.length, true);
      return;
    }
    this.applyBadges();
    this.panel.setCurrentPly(state.inVariation || state.ply > a.moves.length ? null : state.ply);
  }

  /**
   * The panel shows only when there is something to analyse, and in live games
   * only once the game is over (live ratings cover the game in progress).
   * Called on page changes too, since the game can end without a new position.
   */
  refreshVisibility(): void {
    const hasMoves = (this.state?.sans.length ?? 0) > 0;
    const gameDone =
      this.kind !== 'game' || !isLiveGamePath(location.pathname) || isGameOver(document);
    this.panel.setVisible(!!this.abort || !!this.analysis || (hasMoves && gameDone));
  }

  /**
   * Show a saved analysis of this exact game, if one made with the selected
   * engine (or the full one) and search settings at least as deep as the
   * current ones exists; otherwise the game is analysed again on request.
   */
  private async loadCached(sans: readonly string[]): Promise<void> {
    const key = cacheKey(sans);
    if (!sans.length || key === this.cacheChecked) return;
    this.cacheChecked = key;
    let cache: unknown;
    try {
      cache = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
    } catch {
      return;
    }
    const { engine, analysisDepth } = this.getSettings();
    const hit = findCached(cache, sans, engine, analysisDepth);
    if (!hit || this.analysis || this.abort || cacheKey(this.state?.sans ?? []) !== key) return;
    // Re-rate from the saved evaluations, so changes to the rating rules
    // apply to games analysed before them.
    const a = hit.analysis;
    const moves = classifyGame(a.sans, replay(a.sans).uci, a.positions);
    this.show({ ...a, moves, opening: gameOpening(a.positions, moves), summary: summarize(moves) });
  }

  /**
   * Saved under the moves on the page (what loadCached looks up), which can
   * be more than were analysed if a move could not be replayed.
   */
  private async saveCached(sans: readonly string[], analysis: GameAnalysis, engine: EngineKind): Promise<void> {
    const entry = { key: cacheKey(sans), profile: profileFor(engine, analysis.depth, analysis.positions), analysis };
    try {
      const cache = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
      await chrome.storage.local.set({ [CACHE_KEY]: withEntry(cache, entry) });
    } catch {
      // Only a convenience; the analysis is still shown.
    }
  }

  private show(analysis: GameAnalysis): void {
    this.analysis = analysis;
    this.partial = null;
    const ply = this.state && !this.state.inVariation ? this.state.ply : null;
    this.panel.showResult(analysis, ply);
    this.refreshVisibility();
    this.applyBadges();
    this.onAnalysed?.();
  }

  /** Engines for a run: reuse the pool, growing or rebuilding it as needed. */
  private engines(): EngineClient[] {
    const full = this.getSettings().engine === 'full';
    const size = poolSize(full);
    while (this.pool.length < size) this.pool.push(new EngineClient());
    for (const e of this.pool.splice(size)) e.disconnect();
    for (const e of this.pool) e.setFullEngine(full);
    return this.pool;
  }

  private async run(): Promise<void> {
    if (!this.state || this.abort) return;
    const sans = this.state.sans;
    const abort = new AbortController();
    this.abort = abort;
    this.analysis = null;
    this.partial = null;
    clearMoveBadges();
    this.panel.showProgress(0, sans.length + 1);
    let engineError: string | null = null;
    const selected = this.getSettings().engine;
    const engines = this.engines();
    for (const engine of engines) engine.onError = (message) => { engineError = message; };
    let result: GameAnalysis | null;
    try {
      result = await analyzeGame(sans, engines, {
        depth: this.getSettings().analysisDepth,
        signal: abort.signal,
        onProgress: (done, total) => !abort.signal.aborted && this.panel.showProgress(done, total),
        onPartial: (moves) => {
          if (abort.signal.aborted) return;
          this.partial = moves;
          this.applyBadges();
        },
      });
    } catch (error) {
      if (this.abort !== abort) return;
      this.abort = null;
      this.partial = null;
      clearMoveBadges();
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[Vektra] Full-game analysis failed:', error);
      this.panel.showIdle(this.state?.sans.length ?? 0, false, `Analysis failed: ${detail}. Try again.`);
      return;
    }
    if (this.abort !== abort) return;
    this.abort = null;
    if (!result) {
      this.partial = null;
      clearMoveBadges();
      const message = engineError
        ? `The chess engine failed: ${engineError}. Try again.`
        : 'Analysis stopped before completion.';
      this.panel.showIdle(this.state?.sans.length ?? 0, false, message);
      return;
    }
    const engine = usedEngine(engines.map((e) => e.engine), selected);
    result.engine = engineLabel(engine);
    this.show(result);
    void this.saveCached(sans, result, engine);
  }

  /** Called when an analysis finishes, so the board can redraw with it. */
  onAnalysed?: () => void;

  private cancel(): void {
    this.abort?.abort();
    this.abort = null;
    for (const e of this.pool) e.stop();
    this.partial = null;
    clearMoveBadges();
    this.panel.showIdle(this.state?.sans.length ?? 0, false, 'Analysis cancelled.');
  }

  /** Badges, re-applied whenever chess.com re-renders its move list. */
  private applyBadges(): void {
    const list = findMoveList(document, this.state?.board);
    const moves = this.analysis?.moves ?? this.partial;
    if (!list || !moves) return;
    applyMoveBadges(list, moves);
    if (list !== this.observedList) {
      this.listObserver?.disconnect();
      this.observedList = list;
      this.listObserver = new MutationObserver(() => {
        const current = this.analysis?.moves ?? this.partial;
        if (current) applyMoveBadges(list, current);
      });
      this.listObserver.observe(list, { childList: true, subtree: true });
    }
  }

  /** Navigate chess.com's own move list to a ply (from the eval graph). */
  private goToPly(ply: number): void {
    if (ply < 1) return;
    const list = findMoveList(document, this.state?.board);
    const node = list?.querySelector<HTMLElement>(`${SELECTORS.mainLinePly[0]}[${SELECTORS.plyNodeAttr}="0-${ply - 1}"]`);
    node?.click();
  }

  dispose(): void {
    this.abort?.abort();
    for (const e of this.pool) e.disconnect();
    this.listObserver?.disconnect();
    clearMoveBadges();
    this.panel.destroy();
  }
}
