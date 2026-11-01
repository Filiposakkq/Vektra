import { EngineClient } from '../engine/client';
import type { AnalyzeRequest, SearchResult } from '../engine/protocol';
import { whitePov, type PvLine, type Score } from '../engine/uci';
import { winPercent } from '../analysis/winProbability';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import { EvalBar } from '../ui/evalBar';
import { BoardOverlay, type Arrow } from '../ui/overlay';
import type { BoardState } from './boardReader';
import type { PageKind } from './pageScope';
import { describeMoveAnalysis, type MoveAnalysis, type PositionEval } from '../analysis/moveAnalysis';
import { handleStaleExtension } from './extensionUpdate';
import { arrowScoreLabel, hintMoveArrows, isStrengthLimited, scoreArrows, steadyLines } from './hintArrows';
import { drawAvoidingLine, drawsAfter, extendHistory, fenAfterMove, gameHistory, type GameHistory } from './gameHistory';
import { buildRequest, buildThreatRequest, buildWeakerRequest } from './hintRequests';
import { LiveRatings, userMoveToRate } from './liveRatings';
import { shouldHint } from './userSide';
import { chooseWeakerMove, type MoveChoice } from './weakerMoves';

/*
 * The hint controller: runs the engine searches for each position and draws
 * the result. The pieces it uses live in hintArrows (what to draw),
 * hintRequests (what to search), gameHistory, weakerMoves and liveRatings.
 */

/** Don't draw full-strength lines shallower than this; early depths flicker. */
const MIN_DRAW_DEPTH = 8;
/** Strength-limited searches show a provisional line sooner while they continue. */
const LIMITED_DRAW_DEPTH = 4;
/** Search depth at which a provisional live move rating is useful. */
const EARLY_RATING_DEPTH = 4;
/** Depth from which the quick weaker-move pass draws its lines. */
const WEAKER_DRAW_DEPTH = 5;
/** Bot replies whose positions are searched ahead while the bot thinks. */
const PONDER_REPLIES = 2;
/** Final search results kept per request, so revisited positions show at once. */
const SEARCH_CACHE_SIZE = 300;

/** Runs the engine on each new position and draws the result on the board. */
export class HintController {
  private engine = new EngineClient();
  /** Extra engines for the quick passes and thinking ahead, made when first needed. */
  private helpers: EngineClient[] = [];
  private overlay: BoardOverlay | null = null;
  private evalBar: EvalBar | null = null;
  private settings: Settings = DEFAULT_SETTINGS;

  private current: { state: BoardState; kind: PageKind } | null = null;
  private lines: PvLine[] = [];
  /** undefined while searching; null when the side to move has no moves. */
  private bestmove: string | null | undefined;
  private moveChoice: MoveChoice | null = null;
  /** Lines from the weaker-move search, and whether it is still running. */
  private weakerLines: PvLine[] = [];
  private weakerPending = false;
  /** The best move of the previous search update, to tell a lasting change from a flicker. */
  private lastUpdateTop: string | null = null;
  /** Counts update() calls, to tell an outdated search chain from the current one. */
  private updateGeneration = 0;
  /** Final results of recent searches, by request. */
  private searchCache = new Map<string, SearchResult>();
  /** 0: hidden (on demand), 1: only the piece to move, 2: the full hint. */
  private revealStage: 0 | 1 | 2 = 0;
  /** The bot's threat in this position, when it is worth showing. */
  private threat: { move: string; score: Score } | null = null;

  private ratings = new LiveRatings();

  /** Full-game analysis of the shown position, when there is one. */
  analysisLookup: ((state: BoardState) => PositionEval | undefined) | null = null;
  /** The analysed move that led to the shown position, for its board icon. */
  analysedMove: ((state: BoardState) => MoveAnalysis | undefined) | null = null;
  /** Called after a live-game search completes, with the choice and elapsed time. */
  onMoveChosen?: (state: BoardState, move: string, searchTimeMs: number, lossCp: number) => void;
  /** Called when the enabled autoplay flow is ready to submit a move. */
  onBestMove?: (state: BoardState, move: string) => void;
  onEngineError?: (message: string) => void;
  onEngineReady?: () => void;

  constructor() {
    this.engine.onError = (message) => this.onEngineError?.(message);
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    for (const engine of [this.engine, ...this.helpers]) engine.setFullEngine(settings.engine === 'full');
    if (settings.lightMode && this.helpers.length) {
      // One engine only: close the extra ones and free their memory.
      for (const helper of this.helpers) helper.disconnect();
      this.helpers = [];
    }
    if (this.current) this.update(this.current.state, this.current.kind);
  }

  /** Redraw the current position, e.g. after an analysis finishes. */
  refresh(): void {
    if (this.current) this.update(this.current.state, this.current.kind);
  }

  /** The "show hint" shortcut: reveal the hint for the current position now. */
  showHint(): void {
    if (!this.current || !this.settings.enabled) return;
    // Step by step unless autoplay is on: then the press is to play the move.
    const stepped = this.settings.hintSteps && !this.settings.autoPlay;
    this.revealStage = stepped && this.revealStage === 0 ? 1 : 2;
    this.redraw();
    this.autoPlayCurrent();
  }

  update(state: BoardState, kind: PageKind): void {
    this.current = { state, kind };
    this.lines = [];
    this.bestmove = undefined;
    this.moveChoice = null;
    this.weakerLines = [];
    this.weakerPending = false;
    this.lastUpdateTop = null;
    this.threat = null;
    this.overlay ??= new BoardOverlay(state.board);
    this.overlay.clear();
    // The helpers' searches belong to the previous position.
    for (const helper of this.helpers) helper.stop();

    if (!this.settings.enabled) {
      this.engine.stop();
      this.evalBar?.destroy();
      this.evalBar = null;
      return;
    }
    this.evalBar ??= new EvalBar();

    // An analysed position shows the engine's preferred line from the analysis.
    const analysed = this.analysisLookup?.(state);
    if (analysed) {
      this.engine.stop();
      this.evalBar?.update(state.board, analysed.score, state.flipped, analysed.lines[0]?.depth);
      // One line of play (move, reply, next move), numbered, not alternatives.
      const line = analysed.lines[0]?.pv.slice(0, 3) ?? [];
      const label = this.settings.arrowScores ? arrowScoreLabel(analysed.score) : undefined;
      this.overlay.draw(
        state.board,
        line.map((move, i) => ({ move, rank: i, step: i + 1, ...(i === 0 && label ? { label } : {}) })),
        state.flipped,
      );
      const played = this.analysedMove?.(state);
      if (played) {
        this.overlay.drawBadge(
          state.board,
          {
            square: played.uci.slice(2, 4),
            category: played.category,
            title: describeMoveAnalysis(played),
          },
          state.flipped,
        );
      }
      return;
    }

    this.ratings.pending = null;
    if (kind === 'game' && this.settings.liveRatings) {
      void userMoveToRate(state)
        .then((pending) => {
          if (this.current?.state !== state) return;
          this.ratings.pending = pending;
          if (this.ratings.rate(state, false)) this.redraw();
        })
        .catch((error: unknown) => {
          if (!handleStaleExtension(error)) console.error('[Vektra] Could not check opening-book status for live move rating:', error);
        });
    }

    this.revealStage = kind !== 'game' || this.settings.hintMode === 'instant' ? 2 : 0;

    const minDepth = Math.min(
      isStrengthLimited(this.settings) ? LIMITED_DRAW_DEPTH : MIN_DRAW_DEPTH,
      this.settings.searchMode === 'depth' ? this.settings.depth : 1,
    );
    const searchStartedAt = performance.now();
    // Changing a setting runs this again for the same position, so the board
    // state alone can't tell an old search chain from the current one.
    const generation = ++this.updateGeneration;
    const stale = () => generation !== this.updateGeneration || this.current?.state !== state;
    const withWeaker = kind === 'game' && this.settings.occasionalWeakerMoves && shouldHint(state, kind);
    // Set once the main search has lines to draw; until then the quick
    // weaker-move pass draws the provisional arrows.
    let mainDrawn = false;

    // The weaker-move and threat passes run on their own engines alongside the
    // main search, so what they add shows within moments and nothing waits in
    // line; in light mode one engine runs them first, one at a time. The
    // weaker-move pass is quick and wide; it also draws the first arrows (the
    // violet one included) until the main search has lines.
    const parallel = !this.settings.lightMode;
    // The game's moves go with each search, so the engine sees repetitions.
    const game = gameHistory(state);
    const withThreat = kind === 'game' && this.settings.showThreats && shouldHint(state, kind);
    let weakerDone: Promise<void> = Promise.resolve();
    if (withWeaker) this.weakerPending = true;
    const runWeaker = (): Promise<void> => this
      .search(buildWeakerRequest(state.fen, this.settings, game), (lines) => {
        if (stale() || !(lines[0]?.depth >= WEAKER_DRAW_DEPTH)) return;
        this.weakerLines = lines;
        if (!mainDrawn) this.lines = this.steady(lines);
        this.redraw();
      }, parallel ? this.helper(0) : this.engine)
      .then((weaker) => {
        if (!weaker || stale()) return;
        this.weakerLines = weaker.lines;
        if (!mainDrawn) this.lines = weaker.lines;
        this.redraw();
      });
    const runThreat = (): Promise<void> => withThreat
      ? this.searchThreat(state, stale, parallel ? this.helper(1) : this.engine)
      : Promise.resolve();

    const runMain = () => void this
      .search(buildRequest(state.fen, this.settings, game), (lines) => {
        if (stale() || !(lines[0]?.depth > 0)) return;
        this.ratings.remember(state, lines);
        if (lines[0].depth >= EARLY_RATING_DEPTH && this.ratings.rate(state, false)) this.redraw();
        if (lines[0].depth < minDepth) return;
        mainDrawn = true;
        this.lines = this.steady(lines);
        this.redraw();
      })
      .then(async (result) => {
        if (!result || stale()) return;
        this.onEngineReady?.();
        this.lines = result.lines;
        this.bestmove = result.bestmove;
        this.ratings.remember(state, result.lines);
        this.ratings.rate(state, true);
        let bestmove = result.bestmove;
        // Avoid draws: when the best move draws at once and another keeps the
        // game going about level, show and play that one instead.
        const avoiding = this.settings.avoidDraws && game && bestmove && kind === 'game' && shouldHint(state, kind);
        const keepGoing = avoiding ? drawAvoidingLine(game, result.lines, bestmove!) : null;
        if (keepGoing) {
          bestmove = keepGoing.pv[0];
          this.bestmove = bestmove;
          this.lines = [keepGoing, ...result.lines.filter((line) => line !== keepGoing)]
            .map((line, i) => ({ ...line, multipv: i + 1 }));
        }
        this.redraw();
        // The weaker move is picked against the main search's final choice,
        // once its candidates are in; autoplay waits for both.
        await weakerDone;
        if (stale()) return;
        this.moveChoice = withWeaker && this.settings.autoPlay && bestmove
          ? chooseWeakerMove(state.fen, bestmove, this.weakerLines, this.settings)
          : null;
        // A weaker move that draws at once isn't played when avoiding draws.
        if (this.moveChoice && avoiding && drawsAfter(game!, this.moveChoice.move)) this.moveChoice = null;
        this.weakerPending = false;
        this.redraw();
        // Report the choice before autoplay plans it, so its delay belongs to it.
        if (kind === 'game' && shouldHint(state, kind) && bestmove) {
          this.onMoveChosen?.(
            state,
            this.moveChoice?.move ?? bestmove,
            Math.round(performance.now() - searchStartedAt),
            this.moveChoice?.lossCp ?? 0,
          );
        }
        this.autoPlayCurrent();
        // On the bot's turn, get the user's next position ready for its two
        // most likely replies.
        if (kind === 'game' && !shouldHint(state, kind)) {
          const replies = [...result.lines]
            .sort((a, b) => a.multipv - b.multipv)
            .map((line) => line.pv[0])
            .filter((move): move is string => !!move)
            .slice(0, PONDER_REPLIES);
          this.ponder(state.fen, game, replies, stale);
        }
      });

    if (parallel) {
      if (withWeaker) weakerDone = runWeaker();
      void runThreat();
      runMain();
    } else {
      if (withWeaker) weakerDone = runWeaker();
      void weakerDone
        .then(() => (stale() ? undefined : runThreat()))
        .then(() => {
          if (!stale()) runMain();
        });
    }
  }

  /** A helper engine (0: weaker moves, 1: threats; both also think ahead). */
  private helper(index: number): EngineClient {
    while (this.helpers.length <= index) {
      const engine = new EngineClient();
      engine.setFullEngine(this.settings.engine === 'full');
      engine.onError = (message) => this.onEngineError?.(message);
      this.helpers.push(engine);
    }
    return this.helpers[index];
  }

  /**
   * While the bot thinks, search the positions after its likely replies (most
   * likely first), with the same requests update() will make there, in the
   * same order. When the bot plays one of them, the hints come straight from
   * the cache. The next position's update cancels whatever is still running.
   */
  private ponder(fen: string, game: GameHistory | null, replies: readonly string[], stale: () => boolean): void {
    const s = this.settings;
    // Each reply gets its own engine, so the replies are searched side by
    // side; in light mode only the most likely reply is searched.
    if (this.settings.lightMode) replies = replies.slice(0, 1);
    const engines = this.settings.lightMode ? [this.engine] : [this.engine, this.helper(0), this.helper(1)];
    replies.forEach((reply, i) => {
      const next = fenAfterMove(fen, reply);
      if (!next) return;
      // The same game moves the next update will send, so the cache matches.
      const nextGame = game ? extendHistory(game, reply) : null;
      const requests = [
        s.occasionalWeakerMoves ? buildWeakerRequest(next, s, nextGame) : null,
        s.showThreats ? buildThreatRequest(next, s) : null,
        buildRequest(next, s, nextGame),
      ].filter((req): req is AnalyzeRequest => req !== null);
      const engine = engines[i % engines.length];
      void (async () => {
        for (const req of requests) {
          if (stale()) return;
          if (!(await this.search(req, undefined, engine))) return;
        }
      })();
    });
  }

  /** Lines from a search update, kept steady against the ones shown (see steadyLines). */
  private steady(lines: PvLine[]): PvLine[] {
    const top = [...lines].sort((a, b) => a.multipv - b.multipv)[0]?.pv[0] ?? null;
    const persisted = top !== null && top === this.lastUpdateTop;
    this.lastUpdateTop = top;
    return steadyLines(this.lines, lines, persisted);
  }

  /** An engine search, answered from the cache when the same request was searched before. */
  private search(
    req: AnalyzeRequest,
    onUpdate?: (lines: PvLine[]) => void,
    engine: EngineClient = this.engine,
  ): Promise<SearchResult | null> {
    const key = `${this.settings.engine}|${JSON.stringify(req)}`;
    const cached = this.searchCache.get(key);
    if (cached) {
      // Most recently used last, so the oldest is dropped first.
      this.searchCache.delete(key);
      this.searchCache.set(key, cached);
      return Promise.resolve(cached);
    }
    return engine.analyze(req, onUpdate).then((result) => {
      if (result) {
        this.searchCache.set(key, result);
        if (this.searchCache.size > SEARCH_CACHE_SIZE) this.searchCache.delete(this.searchCache.keys().next().value!);
      }
      return result;
    });
  }

  /**
   * Search the position as if the user passed. The bot's best move there is
   * its threat; whether it is worth showing is judged in threatMove against
   * the latest evaluation, so it can show before the main search settles.
   */
  private searchThreat(state: BoardState, stale: () => boolean, engine: EngineClient): Promise<void> {
    const req = buildThreatRequest(state.fen, this.settings);
    if (!req) return Promise.resolve();
    return this
      .search(req, undefined, engine)
      .then((result) => {
        const line = result?.lines[0];
        if (!result?.bestmove || !line || stale()) return;
        this.threat = { move: result.bestmove, score: line.score };
        this.redraw();
      });
  }

  /** The threat, when allowing it would cost the user enough win chance. */
  private threatMove(): string | null {
    const best = [...this.lines].sort((a, b) => a.multipv - b.multipv)[0];
    if (!this.threat || !best) return null;
    // The user's win chance now, against after the bot's free move.
    const loss = winPercent(best.score) - (100 - winPercent(this.threat.score));
    return loss >= this.settings.threatWinLoss ? this.threat.move : null;
  }

  private autoPlayCurrent(): void {
    if (!this.settings.autoPlay || this.revealStage < 2 || !this.bestmove || this.weakerPending || !this.current) return;
    const { state, kind } = this.current;
    if (kind === 'game' && shouldHint(state, kind)) {
      this.onBestMove?.(state, this.moveChoice?.move ?? this.bestmove);
    }
  }

  private redraw(): void {
    if (!this.current || !this.overlay) return;
    const { state, kind } = this.current;
    const turn = state.fen.split(' ')[1] as 'w' | 'b';

    if (this.lines.length) {
      this.evalBar?.update(state.board, whitePov(this.lines[0].score, turn), state.flipped, this.lines[0].depth);
    }

    this.overlay.draw(state.board, this.arrowsFor(state, kind), state.flipped);
    // First step of an on-demand hint: only the piece to move.
    if (this.revealStage === 1 && shouldHint(state, kind)) {
      const primary = this.moveArrows(state, kind).find((arrow) => arrow.rank === 0);
      if (primary) this.overlay.drawPieceHint(state.board, primary.move.slice(0, 2), state.flipped);
    }
    this.ratings.draw(state, this.overlay);
  }

  private arrowsFor(state: BoardState, kind: PageKind): Arrow[] {
    if (this.revealStage === 0 || !shouldHint(state, kind)) return [];
    const threatMove = this.threatMove();
    const threat: Arrow[] = threatMove ? [{ move: threatMove, rank: 0, threat: true }] : [];
    if (this.revealStage < 2) return threat;
    const turn = state.fen.split(' ')[1] as 'w' | 'b';
    const searching = this.bestmove === undefined;
    // The weaker move's score may only be in the weaker-move search's lines.
    const lines = [
      ...this.lines,
      ...this.weakerLines.filter((line) => !this.lines.some((main) => main.pv[0] === line.pv[0])),
    ];
    const moves = scoreArrows(this.moveArrows(state, kind), lines, turn, {
      showScores: this.settings.arrowScores,
      hideWorse: !this.settings.weakenedShowsTopMoves,
      maxWinLoss: this.settings.hideWorseWinLoss,
    }).map((arrow) => (searching ? { ...arrow, provisional: true } : arrow));
    return [...threat, ...moves];
  }

  /** The move arrows for the position, before scores are added. */
  private moveArrows(state: BoardState, kind: PageKind): Arrow[] {
    if (!shouldHint(state, kind)) return [];
    return hintMoveArrows({
      kind,
      fen: state.fen,
      settings: this.settings,
      lines: this.lines,
      weakerLines: this.weakerLines,
      bestmove: this.bestmove,
      moveChoice: this.moveChoice,
    });
  }

  dispose(): void {
    this.engine.disconnect();
    for (const helper of this.helpers) helper.disconnect();
    this.helpers = [];
    this.overlay?.destroy();
    this.evalBar?.destroy();
    this.overlay = null;
    this.evalBar = null;
    this.current = null;
  }
}
