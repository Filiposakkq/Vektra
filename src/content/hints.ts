import { Chess } from 'chess.js';
import { EngineClient } from '../engine/client';
import type { AnalyzeRequest, SearchResult } from '../engine/protocol';
import { scoreToCp, whitePov, type PvLine, type Score } from '../engine/uci';
import { winPercent } from '../analysis/winProbability';
import { DEFAULT_SETTINGS, WEAKER_CANDIDATE_MULTIPV, WEAKER_MOVE_MULTIPV, type Settings } from '../shared/settings';
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
/** Limits for the threat search, a quick pass before the main one. */
const THREAT_DEPTH = 10;
const THREAT_MOVETIME_MS = 300;
/**
 * Limits for the quick weaker-move pass, which runs before the main search,
 * and the depth from which its lines are drawn.
 */
const WEAKER_SEARCH_DEPTH = 10;
const WEAKER_SEARCH_MOVETIME_MS = 400;
const WEAKER_DRAW_DEPTH = 5;
/** Bot replies whose positions are searched ahead while the bot thinks. */
const PONDER_REPLIES = 2;
/** Final search results kept per request, so revisited positions show at once. */
const SEARCH_CACHE_SIZE = 300;

/** Short score for an arrow, from White's point of view: "+0.8", "-1.3", "M3", "-M2". */
export function arrowScoreLabel(score: Score): string {
  if (score.type === 'mate') return `${score.value < 0 ? '-' : ''}M${Math.abs(score.value)}`;
  const v = score.value / 100;
  return `${v > 0.05 ? '+' : ''}${(Math.abs(v) < 0.05 ? 0 : v).toFixed(1)}`;
}

/**
 * Add scores to arrows from their engine lines, fade alternatives by how much
 * win chance they give up against the best line (faintest at maxWinLoss), and
 * drop alternatives that give up more than maxWinLoss (unless every candidate
 * line was asked for).
 */
export function scoreArrows(
  arrows: Arrow[],
  lines: PvLine[],
  sideToMove: 'w' | 'b',
  {
    showScores,
    hideWorse,
    maxWinLoss = DEFAULT_SETTINGS.hideWorseWinLoss,
  }: { showScores: boolean; hideWorse: boolean; maxWinLoss?: number },
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
    if (alternative && hideWorse && winLoss > maxWinLoss) continue;
    scored.push({
      ...arrow,
      ...(showScores ? { label: arrowScoreLabel(whitePov(line.score, sideToMove)) } : {}),
      ...(alternative && winLoss > 0 ? { winLoss, fadeFullAt: maxWinLoss } : {}),
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

/** A new best move must beat the shown one by more than this (centipawns) to replace it at once. */
export const STEADY_MARGIN_CP = 30;

/**
 * Lines to show for a search update, keeping the arrows steady: while the
 * engine is still searching, the shown best move stays first unless the new
 * best has also led the previous update (`persisted`) or is clearly better.
 * Otherwise the lines are reordered with the shown move first. The final
 * result is shown as it is, not through this.
 */
export function steadyLines(
  shown: readonly PvLine[],
  next: PvLine[],
  persisted: boolean,
  marginCp = STEADY_MARGIN_CP,
): PvLine[] {
  const ordered = [...next].sort((a, b) => a.multipv - b.multipv);
  const shownTop = [...shown].sort((a, b) => a.multipv - b.multipv)[0]?.pv[0];
  const newTop = ordered[0]?.pv[0];
  if (!shownTop || !newTop || shownTop === newTop || persisted) return next;
  const kept = ordered.find((line) => line.pv[0] === shownTop);
  if (!kept || scoreToCp(ordered[0].score) - scoreToCp(kept.score) > marginCp) return next;
  return [kept, ...ordered.filter((line) => line !== kept)].map((line, i) => ({ ...line, multipv: i + 1 }));
}

/** The game so far: every position (from the start) and the moves between them. */
export interface GameHistory {
  fens: string[];
  uci: string[];
}

/** The game that led to the board's position, or null when it can't be replayed from the move list. */
export function gameHistory(state: BoardState): GameHistory | null {
  if (state.source !== 'replay' || state.inVariation) return null;
  const { fens, uci, failedAt } = replay(state.sans.slice(0, state.ply));
  if (failedAt !== null || fens[fens.length - 1] !== state.fen) return null;
  return { fens, uci };
}

/**
 * The part of the game the engine needs: from the last capture or pawn move
 * on (nothing before it can repeat, and its FEN carries the 50-move count).
 * Keeping it short keeps cached searches reusable.
 */
export function searchHistory(game: GameHistory): NonNullable<AnalyzeRequest['history']> {
  let start = 0;
  for (let i = game.fens.length - 1; i >= 0; i--) {
    if (game.fens[i].split(' ')[4] === '0') {
      start = i;
      break;
    }
  }
  return { startFen: game.fens[start], moves: game.uci.slice(start) };
}

/** The game after one more move, or null if it is illegal. */
export function extendHistory(game: GameHistory, uci: string): GameHistory | null {
  const next = fenAfterMove(game.fens[game.fens.length - 1], uci);
  return next ? { fens: [...game.fens, next], uci: [...game.uci, uci] } : null;
}

/** True if playing the move ends the game in a draw at once: repetition, stalemate, 50 moves or too little material. */
export function drawsAfter(game: GameHistory, uci: string): boolean {
  const { startFen, moves } = searchHistory(game);
  try {
    const chess = new Chess(startFen);
    for (const move of [...moves, uci]) {
      chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
    }
    return chess.isDraw();
  } catch {
    return false;
  }
}

/** Most an "avoid draws" move may give up against the drawing best move, in centipawns. */
export const AVOID_DRAW_MAX_LOSS_CP = 100;
/** ...and the worst score (for the mover) it may leave: about level. */
export const AVOID_DRAW_MIN_SCORE_CP = -30;

/**
 * When the best move draws at once, the best of the other lines that doesn't
 * and keeps the mover about level (within AVOID_DRAW_MAX_LOSS_CP of the best
 * and no worse than AVOID_DRAW_MIN_SCORE_CP), or null to keep the best move.
 */
export function drawAvoidingLine(game: GameHistory, lines: readonly PvLine[], bestmove: string): PvLine | null {
  if (!drawsAfter(game, bestmove)) return null;
  const ordered = [...lines].sort((a, b) => a.multipv - b.multipv);
  const best = ordered.find((line) => line.pv[0] === bestmove) ?? ordered[0];
  if (!best) return null;
  const bestCp = scoreToCp(best.score);
  for (const line of ordered) {
    const move = line.pv[0];
    if (!move || move === bestmove || drawsAfter(game, move)) continue;
    const cp = scoreToCp(line.score);
    if (bestCp - cp <= AVOID_DRAW_MAX_LOSS_CP && cp >= AVOID_DRAW_MIN_SCORE_CP) return line;
  }
  return null;
}

/** The position after a UCI move, as the board reader would report it, or null if the move is illegal. */
export function fenAfterMove(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return chess.fen();
  } catch {
    return null;
  }
}

/** Legal moves in a position, or null when the FEN can't be read. */
function legalMoveCount(fen: string): number | null {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return null;
  }
}

/**
 * Never ask for more lines than there are legal moves: the engine reports a
 * depth only once its last line arrives, so a line that can't exist (often
 * in check) would hold every update back until the search ends.
 */
export function capLines(fen: string, multipv: number): number {
  const legal = legalMoveCount(fen);
  return legal === null ? multipv : Math.max(1, Math.min(multipv, legal));
}

/** Engine memory for hint searches, in MiB; kept the same for every hint search, since changing it clears it. */
export const HINT_HASH_MB = 64;

/** Options every hint search shares, so the engine never resets between them. */
function hintEngineOptions(): Pick<AnalyzeRequest, 'hashMb'> {
  return { hashMb: HINT_HASH_MB };
}

/** The game's moves for a search, when known (see searchHistory). */
function historyOption(game?: GameHistory | null): Pick<AnalyzeRequest, 'history'> {
  return game ? { history: searchHistory(game) } : {};
}

export function buildRequest(fen: string, s: Settings, game?: GameHistory | null): AnalyzeRequest {
  return {
    fen,
    // Avoiding a draw needs at least one other line to choose from.
    multipv: capLines(fen, Math.max(s.arrows, s.weakenedShowsTopMoves ? WEAKER_MOVE_MULTIPV : 1, s.avoidDraws ? 2 : 1)),
    limit: s.searchMode === 'depth' ? { depth: s.depth } : { movetimeMs: s.movetimeMs },
    strength: { skillLevel: s.skillLevel, limitStrength: s.limitStrength, elo: s.elo },
    ...hintEngineOptions(),
    ...historyOption(game),
  };
}

/** The threat search for a position: the opponent's best move if the side to move passed. Null in check. */
export function buildThreatRequest(fen: string, s: Settings): AnalyzeRequest | null {
  const passed = nullMoveFen(fen);
  if (!passed) return null;
  return {
    fen: passed,
    multipv: 1,
    limit: s.searchMode === 'depth'
      ? { depth: Math.min(s.depth, THREAT_DEPTH) }
      : { movetimeMs: Math.min(s.movetimeMs, THREAT_MOVETIME_MS) },
    strength: { skillLevel: 20, limitStrength: false, elo: s.elo },
    ...hintEngineOptions(),
  };
}

/**
 * The quick search for weaker-move candidates, run next to the main one: many
 * lines, since the top few are usually close together, at a shallower limit so
 * it stays quick. The main search keeps few lines and its full depth.
 */
export function buildWeakerRequest(fen: string, s: Settings, game?: GameHistory | null): AnalyzeRequest {
  return {
    fen,
    multipv: capLines(fen, WEAKER_CANDIDATE_MULTIPV),
    limit: s.searchMode === 'depth'
      ? { depth: Math.min(s.depth, WEAKER_SEARCH_DEPTH) }
      : { movetimeMs: Math.min(s.movetimeMs, WEAKER_SEARCH_MOVETIME_MS) },
    strength: { skillLevel: s.skillLevel, limitStrength: s.limitStrength, elo: s.elo },
    ...hintEngineOptions(),
    ...historyOption(game),
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
        // A search stopped by time ends partway through a depth, so lines
        // one depth apart are still comparable.
        Math.abs(line.depth - baseline.depth) <= 1 &&
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

/**
 * The candidate whose loss is closest to a target between half the loss
 * limit and the full limit (sample 0 → half, 1 → the limit), so a higher
 * limit gives clearly weaker moves instead of just allowing them.
 */
export function pickWeakerCandidate(
  candidates: readonly MoveChoice[],
  maxLossCp: number,
  sample: number,
): MoveChoice | null {
  if (!candidates.length) return null;
  const s = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5;
  const target = maxLossCp * (0.5 + 0.5 * s);
  return candidates.reduce((best, c) => (Math.abs(c.lossCp - target) < Math.abs(best.lossCp - target) ? c : best));
}

/** The weaker move previewed with autoplay off: the typical pick, at three quarters of the limit. */
export function previewWeakerMove(
  fen: string,
  engineMove: string,
  lines: PvLine[],
  settings: Settings,
): MoveChoice | null {
  return pickWeakerCandidate(weakerMoveCandidates(fen, engineMove, lines, settings), settings.weakerMoveMaxLossCp, 0.5);
}

/** Occasionally select a legal MultiPV alternative near the configured loss. */
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
  return pickWeakerCandidate(candidates, settings.weakerMoveMaxLossCp, random());
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
): Promise<{ beforeFen: string; ply: number; san: string; uci: string; book: boolean; previousUci?: string } | null> {
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
    previousUci: uci[state.ply - 2],
  };
}

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

  /** Final engine evaluations of recent positions, for live move ratings. */
  private evals = new Map<string, PositionEval>();
  /** The user's last rated move in a live game, shown on its square. */
  private rating: { move: MoveAnalysis; sans: string[] } | null = null;
  private pendingRating: Awaited<ReturnType<typeof userMoveToRate>> = null;

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
        this.rememberEval(state, lines);
        if (lines[0].depth >= EARLY_RATING_DEPTH && this.rateMove(state, false)) this.redraw();
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
        this.rememberEval(state, result.lines);
        this.rateMove(state, true);
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
    const move = analyzeMove(before, after, p, { book: p.book, previousUci: p.previousUci });
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
    if (!shouldHint(state, kind) || this.bestmove === null) return [];
    if (
      kind === 'game' &&
      !this.settings.autoPlay &&
      this.settings.occasionalWeakerMoves &&
      this.lines.length
    ) {
      const primary = this.bestmove ?? this.lines[0].pv[0];
      const weaker = previewWeakerMove(state.fen, primary, this.weakerLines, this.settings);
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
    for (const helper of this.helpers) helper.disconnect();
    this.helpers = [];
    this.overlay?.destroy();
    this.evalBar?.destroy();
    this.overlay = null;
    this.evalBar = null;
    this.current = null;
  }
}
