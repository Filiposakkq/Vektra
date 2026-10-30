import { EngineClient } from '../engine/client';
import type { AnalyzeRequest } from '../engine/protocol';
import { scoreToCp, whitePov, type PvLine } from '../engine/uci';
import { DEFAULT_SETTINGS, WEAKER_MOVE_MULTIPV, type Settings } from '../shared/settings';
import { EvalBar } from '../ui/evalBar';
import { BoardOverlay, type Arrow } from '../ui/overlay';
import type { BoardState } from './boardReader';
import type { PageKind } from './pageScope';
import {
  analyzeMove,
  describeMoveAnalysis,
  terminalScore,
  type MoveAnalysis,
  type PositionEval,
} from '../analysis/moveAnalysis';
import { uciToSan } from '../analysis/chessNotation';
import { replay } from './fen';

/** Don't draw full-strength lines shallower than this; early depths flicker. */
const MIN_DRAW_DEPTH = 8;
/** Strength-limited searches show a provisional line sooner while they continue. */
const LIMITED_DRAW_DEPTH = 4;
/** Search depth at which a provisional live move rating is useful. */
const EARLY_RATING_DEPTH = 4;

export function buildRequest(fen: string, s: Settings): AnalyzeRequest {
  return {
    fen,
    multipv: Math.max(
      s.arrows,
      s.occasionalWeakerMoves || s.weakenedShowsTopMoves ? WEAKER_MOVE_MULTIPV : 1,
    ),
    limit: s.searchMode === 'depth' ? { depth: s.depth } : { movetimeMs: s.movetimeMs },
    strength: { skillLevel: s.skillLevel, limitStrength: s.limitStrength, elo: s.elo },
  };
}

export interface MoveChoice {
  move: string;
  /** Evaluation loss against the engine's chosen move, in centipawns. */
  lossCp: number;
}

/** Only show the selected weaker move, not the normal MultiPV alternatives. */
export function weakerPickArrow(move: string): Arrow {
  return { move, rank: 0, weaker: true };
}

/** Legal MultiPV alternatives that are weaker than the engine's selected move. */
export function weakerMoveCandidates(
  fen: string,
  engineMove: string,
  lines: PvLine[],
  settings: Settings,
): MoveChoice[] {
  if (!settings.occasionalWeakerMoves) return [];
  const ordered = [...lines].sort((a, b) => a.multipv - b.multipv);
  const baseline = ordered.find((line) => line.pv[0] === engineMove) ?? ordered[0];
  if (!baseline?.pv[0]) return [];
  const baselineScore = scoreToCp(baseline.score);
  return ordered
    .filter(
      (line) =>
        line.depth === baseline.depth &&
        line.pv[0] &&
        line.pv[0] !== baseline.pv[0] &&
        line.pv[0] !== engineMove,
    )
    .map((line) => ({ move: line.pv[0], lossCp: baselineScore - scoreToCp(line.score) }))
    .filter(
      (candidate) =>
        candidate.lossCp > 5 &&
        candidate.lossCp <= settings.weakerMoveMaxLossCp &&
        uciToSan(fen, candidate.move) !== null,
    )
    .sort((a, b) => a.lossCp - b.lossCp);
}

/** Occasionally select a legal, close-scoring MultiPV alternative. */
export function chooseWeakerMove(
  fen: string,
  engineMove: string,
  lines: PvLine[],
  settings: Settings,
  random: () => number = Math.random,
): MoveChoice | null {
  if (settings.weakerMoveChancePercent <= 0) return null;
  const candidates = weakerMoveCandidates(fen, engineMove, lines, settings);
  if (!candidates.length) return null;
  const sample = random();
  if (
    !Number.isFinite(sample) ||
    sample < 0 ||
    sample >= settings.weakerMoveChancePercent / 100
  ) return null;
  const selection = random();
  const index = Number.isFinite(selection)
    ? Math.min(candidates.length - 1, Math.floor(Math.max(0, selection) * candidates.length))
    : 0;
  return candidates[index];
}

/** True when the engine's choice is deliberately weakened. */
export function isStrengthLimited(s: Settings): boolean {
  return s.limitStrength || s.skillLevel < 20;
}

/** Arrows for the top lines, best first. */
export function arrowsFromLines(lines: PvLine[], count: number): Arrow[] {
  return lines.slice(0, count).map((l, rank) => ({ move: l.pv[0], rank }));
}

/**
 * The weakened pick followed by alternative top lines. While the search is
 * running, the current top line is marked provisional.
 */
export function weakenedArrows(
  bestmove: string | null | undefined,
  lines: PvLine[],
  count: number,
): Arrow[] {
  if (bestmove === null) return [];
  const provisional = bestmove === undefined;
  const primary = bestmove ?? lines[0]?.pv[0];
  if (!primary) return [];
  const others = lines.map((l) => l.pv[0]).filter((m) => m !== primary);
  return [primary, ...others].slice(0, count).map((move, rank) => ({
    move,
    rank,
    ...(provisional && rank === 0 ? { provisional: true } : {}),
  }));
}

/**
 * In live games, hints only show on the user's turn. The user plays from the
 * bottom of the board, so a flipped board means the user has Black.
 */
export function shouldHint(state: BoardState, kind: PageKind): boolean {
  if (kind !== 'game') return true;
  const userColor = state.flipped ? 'b' : 'w';
  return state.fen.split(' ')[1] === userColor;
}

/**
 * The user's move that led to this position (the side that just moved is the
 * side at the bottom of the board), or null.
 */
export async function userMoveToRate(
  state: BoardState,
): Promise<{ beforeFen: string; ply: number; san: string; uci: string; book: boolean } | null> {
  if (state.inVariation || state.ply < 1 || state.source !== 'replay') return null;
  const userColor = state.flipped ? 'b' : 'w';
  const justMoved = state.fen.split(' ')[1] === 'w' ? 'b' : 'w';
  if (justMoved !== userColor) return null;
  const { fens, uci } = replay(state.sans.slice(0, state.ply));
  if (fens.length !== state.ply + 1) return null;
  const { isBookLine } = await import('../analysis/openingBook');
  return {
    beforeFen: fens[state.ply - 1],
    ply: state.ply,
    san: state.sans[state.ply - 1],
    uci: uci[state.ply - 1],
    book: await isBookLine(fens, state.ply),
  };
}

/** Runs the engine on each new position and draws the result on the board. */
export class HintController {
  private engine = new EngineClient();
  private overlay: BoardOverlay | null = null;
  private evalBar: EvalBar | null = null;
  private settings: Settings = DEFAULT_SETTINGS;

  private current: { state: BoardState; kind: PageKind } | null = null;
  private lines: PvLine[] = [];
  /** undefined while searching; null when the side to move has no moves. */
  private bestmove: string | null | undefined;
  private moveChoice: MoveChoice | null = null;
  private revealed = false;

  /** Final engine evaluations of recent positions, for live move ratings. */
  private evals = new Map<string, PositionEval>();
  /** The user's last rated move in a live game, shown on its square. */
  private rating: { move: MoveAnalysis; sans: string[] } | null = null;
  private pendingRating: { beforeFen: string; ply: number; san: string; uci: string; book: boolean } | null = null;

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
    this.engine.setFullEngine(settings.engine === 'full');
    if (this.current) this.update(this.current.state, this.current.kind);
  }

  /** Redraw the current position, e.g. after an analysis finishes. */
  refresh(): void {
    if (this.current) this.update(this.current.state, this.current.kind);
  }

  /** The "show hint" shortcut: reveal the hint for the current position now. */
  showHint(): void {
    if (!this.current || !this.settings.enabled) return;
    this.revealed = true;
    this.redraw();
    this.autoPlayCurrent();
  }

  update(state: BoardState, kind: PageKind): void {
    this.current = { state, kind };
    this.lines = [];
    this.bestmove = undefined;
    this.moveChoice = null;
    this.overlay ??= new BoardOverlay(state.board);
    this.overlay.clear();

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
      this.evalBar?.update(state.board, analysed.score, state.flipped);
      const line = analysed.lines[0]?.pv.slice(0, 3) ?? [];
      this.overlay.draw(state.board, line.map((move, rank) => ({ move, rank })), state.flipped);
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

    this.pendingRating = null;
    if (kind === 'game' && this.settings.liveRatings) {
      void userMoveToRate(state)
        .then((pending) => {
          if (this.current?.state !== state) return;
          this.pendingRating = pending;
          if (this.rateMove(state, false)) this.redraw();
        })
        .catch((error: unknown) => {
          console.error('[Vektra] Could not check opening-book status for live move rating:', error);
        });
    }

    this.revealed = kind !== 'game' || this.settings.hintMode === 'instant';

    const minDepth = Math.min(
      isStrengthLimited(this.settings) ? LIMITED_DRAW_DEPTH : MIN_DRAW_DEPTH,
      this.settings.searchMode === 'depth' ? this.settings.depth : 1,
    );
    const searchStartedAt = performance.now();
    void this.engine
      .analyze(buildRequest(state.fen, this.settings), (lines) => {
        if (this.current?.state !== state || !(lines[0]?.depth > 0)) return;
        this.rememberEval(state, lines);
        if (lines[0].depth >= EARLY_RATING_DEPTH && this.rateMove(state, false)) this.redraw();
        if (lines[0].depth < minDepth) return;
        this.lines = lines;
        this.redraw();
      })
      .then((result) => {
        if (!result || this.current?.state !== state) return;
        this.onEngineReady?.();
        this.lines = result.lines;
        this.bestmove = result.bestmove;
            this.moveChoice =
              kind === 'game' && this.settings.autoPlay && shouldHint(state, kind) && result.bestmove
            ? chooseWeakerMove(state.fen, result.bestmove, result.lines, this.settings)
            : null;
        this.rememberEval(state, result.lines);
        this.rateMove(state, true);
        this.redraw();
        this.autoPlayCurrent();
        if (kind === 'game' && shouldHint(state, kind) && result.bestmove) {
          this.onMoveChosen?.(
            state,
            this.moveChoice?.move ?? result.bestmove,
            Math.round(performance.now() - searchStartedAt),
            this.moveChoice?.lossCp ?? 0,
          );
        }
      });
  }

  private autoPlayCurrent(): void {
    if (!this.settings.autoPlay || !this.revealed || !this.bestmove || !this.current) return;
    const { state, kind } = this.current;
    if (kind === 'game' && shouldHint(state, kind)) {
      this.onBestMove?.(state, this.moveChoice?.move ?? this.bestmove);
    }
  }

  private rememberEval(state: BoardState, lines: PvLine[]) {
    const turn = state.fen.split(' ')[1] as 'w' | 'b';
    const score = terminalScore(state.fen) ?? (lines[0] ? whitePov(lines[0].score, turn) : null);
    if (!score) return;
    this.evals.delete(state.fen);
    this.evals.set(state.fen, { fen: state.fen, score, lines });
    if (this.evals.size > 300) this.evals.delete(this.evals.keys().next().value!);
  }

  /** Rate the user's move that led to this position, once both evals are known. */
  private rateMove(state: BoardState, final: boolean): boolean {
    const p = this.pendingRating;
    const before = p && this.evals.get(p.beforeFen);
    const after = this.evals.get(state.fen);
    if (!p || !before || !after) return false;
    if (final) this.pendingRating = null;
    const move = analyzeMove(before, after, p, { book: p.book });
    this.rating = { move, sans: state.sans.slice(0, p.ply) };
    return true;
  }

  /** The last rating, if the game on the board still contains that move. */
  private visibleRating(state: BoardState): MoveAnalysis | null {
    const r = this.rating;
    // Only for the user's latest move: shown after it and after the bot's reply.
    if (!r || state.inVariation || state.ply < r.move.ply || state.ply > r.move.ply + 1) return null;
    return r.sans.every((san, i) => state.sans[i] === san) ? r.move : null;
  }

  private drawRating(state: BoardState) {
    const move = this.visibleRating(state);
    if (!move || !this.overlay) return;
    this.overlay.drawBadge(
      state.board,
      {
        square: move.uci.slice(2, 4),
        category: move.category,
        title: describeMoveAnalysis(move),
      },
      state.flipped,
    );
  }

  private redraw(): void {
    if (!this.current || !this.overlay) return;
    const { state, kind } = this.current;
    const turn = state.fen.split(' ')[1] as 'w' | 'b';

    if (this.lines.length) this.evalBar?.update(state.board, whitePov(this.lines[0].score, turn), state.flipped);

    this.overlay.draw(state.board, this.arrowsFor(state, kind), state.flipped);
    this.drawRating(state);
  }

  private arrowsFor(state: BoardState, kind: PageKind): Arrow[] {
    if (!this.revealed || !shouldHint(state, kind) || this.bestmove === null) return [];
    if (
      kind === 'game' &&
      !this.settings.autoPlay &&
      this.settings.occasionalWeakerMoves &&
      this.lines.length
    ) {
      const primary = this.bestmove ?? this.lines[0].pv[0];
      const weaker = weakerMoveCandidates(state.fen, primary, this.lines, this.settings)[0];
      if (weaker) {
        const arrows: Arrow[] = [
          {
            move: primary,
            rank: 0,
            ...(this.bestmove === undefined ? { provisional: true } : {}),
          },
          { move: weaker.move, rank: 1, weaker: true },
        ];
        if (this.settings.weakenedShowsTopMoves) {
          for (const line of this.lines) {
            const move = line.pv[0];
            if (move && !arrows.some((arrow) => arrow.move === move)) {
              arrows.push({ move, rank: arrows.length });
            }
            if (arrows.length >= WEAKER_MOVE_MULTIPV) break;
          }
        }
        return arrows;
      }
    }
    if (this.moveChoice) {
      if (this.settings.weakenedShowsTopMoves) {
        return weakenedArrows(this.moveChoice.move, this.lines, WEAKER_MOVE_MULTIPV).map((arrow, rank) =>
          rank === 0 ? { ...arrow, weaker: true } : arrow,
        );
      }
      return [weakerPickArrow(this.moveChoice.move)];
    }
    if (isStrengthLimited(this.settings)) {
      return weakenedArrows(
        this.bestmove,
        this.lines,
        this.settings.weakenedShowsTopMoves ? WEAKER_MOVE_MULTIPV : 1,
      );
    }
    return arrowsFromLines(
      this.lines,
      this.settings.weakenedShowsTopMoves ? WEAKER_MOVE_MULTIPV : this.settings.arrows,
    );
  }

  dispose(): void {
    this.engine.disconnect();
    this.overlay?.destroy();
    this.evalBar?.destroy();
    this.overlay = null;
    this.evalBar = null;
    this.current = null;
  }
}
