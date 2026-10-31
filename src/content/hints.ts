import { Chess } from 'chess.js';
import { EngineClient } from '../engine/client';
import type { AnalyzeRequest } from '../engine/protocol';
import { scoreToCp, whitePov, type PvLine, type Score } from '../engine/uci';
import { winPercent } from '../analysis/winProbability';
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
import { handleStaleExtension } from './extensionUpdate';

/** Don't draw full-strength lines shallower than this; early depths flicker. */
const MIN_DRAW_DEPTH = 8;
/** Strength-limited searches show a provisional line sooner while they continue. */
const LIMITED_DRAW_DEPTH = 4;
/** Search depth at which a provisional live move rating is useful. */
const EARLY_RATING_DEPTH = 4;
/** Normal alternatives losing more win chance than this (0-100) are not drawn. */
export const MAX_ALTERNATIVE_WIN_LOSS = 10;
/** A threat is shown only when letting the bot play it would cost this much win chance. */
export const THREAT_MIN_WIN_LOSS = 12;
/** Limits for the threat search, which runs after the main one. */
const THREAT_DEPTH = 12;
const THREAT_MOVETIME_MS = 500;

/** Short score for an arrow, from White's point of view: "+0.8", "-1.3", "M3", "-M2". */
export function arrowScoreLabel(score: Score): string {
  if (score.type === 'mate') return `${score.value < 0 ? '-' : ''}M${Math.abs(score.value)}`;
  const v = score.value / 100;
  return `${v > 0.05 ? '+' : ''}${(Math.abs(v) < 0.05 ? 0 : v).toFixed(1)}`;
}

/**
 * Add scores to arrows from their engine lines, fade alternatives by how much
 * win chance they give up against the best line, and drop alternatives that
 * give up too much (unless every candidate line was asked for).
 */
export function scoreArrows(
  arrows: Arrow[],
  lines: PvLine[],
  sideToMove: 'w' | 'b',
  { showScores, hideWorse }: { showScores: boolean; hideWorse: boolean },
): Arrow[] {
  const best = [...lines].sort((a, b) => a.multipv - b.multipv)[0];
  if (!best) return arrows;
  const bestWin = winPercent(best.score);
  const scored: Arrow[] = [];
  for (const arrow of arrows) {
    const line = lines.find((l) => l.pv[0] === arrow.move);
    if (!line) {
      scored.push(arrow);
      continue;
    }
    const alternative = arrow.rank > 0 && !arrow.weaker;
    const winLoss = Math.max(0, bestWin - winPercent(line.score));
    if (alternative && hideWorse && winLoss > MAX_ALTERNATIVE_WIN_LOSS) continue;
    scored.push({
      ...arrow,
      ...(showScores ? { label: arrowScoreLabel(whitePov(line.score, sideToMove)) } : {}),
      ...(alternative && winLoss > 0 ? { winLoss } : {}),
    });
  }
  return scored;
}

/**
 * The position with the other side to move and no en passant square, as if
 * the side to move had passed. Null when it is in check, where passing isn't
 * possible.
 */
export function nullMoveFen(fen: string): string | null {
  try {
    if (new Chess(fen).inCheck()) return null;
  } catch {
    return null;
  }
  const parts = fen.split(' ');
  if (parts.length < 4) return null;
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
}

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
  /** 0: hidden (on demand), 1: only the piece to move, 2: the full hint. */
  private revealStage: 0 | 1 | 2 = 0;
  /** The bot's threat in this position, when it is worth showing. */
  private threat: string | null = null;

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
    this.threat = null;
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

    this.pendingRating = null;
    if (kind === 'game' && this.settings.liveRatings) {
      void userMoveToRate(state)
        .then((pending) => {
          if (this.current?.state !== state) return;
          this.pendingRating = pending;
          if (this.rateMove(state, false)) this.redraw();
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
        if (kind === 'game' && this.settings.showThreats && shouldHint(state, kind)) {
          this.searchThreat(state, result.lines);
        }
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

  /**
   * Search the position as if the user passed. The bot's best move there is
   * its threat; it is kept only when allowing it would cost the user a lot.
   */
  private searchThreat(state: BoardState, lines: PvLine[]): void {
    const best = [...lines].sort((a, b) => a.multipv - b.multipv)[0];
    const fen = nullMoveFen(state.fen);
    if (!best || !fen) return;
    const s = this.settings;
    void this.engine
      .analyze({
        fen,
        multipv: 1,
        limit: s.searchMode === 'depth'
          ? { depth: Math.min(s.depth, THREAT_DEPTH) }
          : { movetimeMs: Math.min(s.movetimeMs, THREAT_MOVETIME_MS) },
        strength: { skillLevel: 20, limitStrength: false, elo: s.elo },
      })
      .then((result) => {
        if (!result?.bestmove || this.current?.state !== state) return;
        const line = result.lines[0];
        if (!line) return;
        // The user's win chance now, against after the bot's free move.
        const loss = winPercent(best.score) - (100 - winPercent(line.score));
        if (loss < THREAT_MIN_WIN_LOSS) return;
        this.threat = result.bestmove;
        this.redraw();
      });
  }

  private autoPlayCurrent(): void {
    if (!this.settings.autoPlay || this.revealStage < 2 || !this.bestmove || !this.current) return;
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

    if (this.lines.length) {
      this.evalBar?.update(state.board, whitePov(this.lines[0].score, turn), state.flipped, this.lines[0].depth);
    }

    this.overlay.draw(state.board, this.arrowsFor(state, kind), state.flipped);
    // First step of an on-demand hint: only the piece to move.
    if (this.revealStage === 1 && shouldHint(state, kind)) {
      const primary = this.moveArrows(state, kind).find((arrow) => arrow.rank === 0);
      if (primary) this.overlay.drawPieceHint(state.board, primary.move.slice(0, 2), state.flipped);
    }
    this.drawRating(state);
  }

  private arrowsFor(state: BoardState, kind: PageKind): Arrow[] {
    if (this.revealStage === 0 || !shouldHint(state, kind)) return [];
    const threat: Arrow[] = this.threat ? [{ move: this.threat, rank: 0, threat: true }] : [];
    if (this.revealStage < 2) return threat;
    const turn = state.fen.split(' ')[1] as 'w' | 'b';
    const searching = this.bestmove === undefined;
    const moves = scoreArrows(this.moveArrows(state, kind), this.lines, turn, {
      showScores: this.settings.arrowScores,
      hideWorse: !this.settings.weakenedShowsTopMoves,
    }).map((arrow) => (searching ? { ...arrow, provisional: true } : arrow));
    return [...threat, ...moves];
  }

  /** The move arrows for the position, before scores are added. */
  private moveArrows(state: BoardState, kind: PageKind): Arrow[] {
    if (!shouldHint(state, kind) || this.bestmove === null) return [];
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
