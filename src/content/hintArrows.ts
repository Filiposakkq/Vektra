import { scoreToCp, whitePov, type PvLine, type Score } from '../engine/uci';
import { winPercent } from '../analysis/winProbability';
import { DEFAULT_SETTINGS, WEAKER_MOVE_MULTIPV, type Settings } from '../shared/settings';
import type { Arrow } from '../ui/overlay';
import type { PageKind } from './pageScope';
import { previewWeakerMove, weakerPickArrow, type MoveChoice } from './weakerMoves';

/*
 * Which arrows a hint draws, and how: scores on them, fading worse
 * alternatives, and keeping them steady while the engine searches.
 */

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

/** What the move arrows of a hint are drawn from. */
export interface HintArrowInput {
  kind: PageKind;
  fen: string;
  settings: Settings;
  /** The main search's lines, and the quick weaker-move search's. */
  lines: PvLine[];
  weakerLines: PvLine[];
  /** undefined while searching; null when the side to move has no moves. */
  bestmove: string | null | undefined;
  /** The weaker move autoplay picked, if it did. */
  moveChoice: MoveChoice | null;
}

/** The move arrows for a position on the user's turn, before scores are added. */
export function hintMoveArrows({ kind, fen, settings, lines, weakerLines, bestmove, moveChoice }: HintArrowInput): Arrow[] {
  if (bestmove === null) return [];
  if (kind === 'game' && !settings.autoPlay && settings.occasionalWeakerMoves && lines.length) {
    const primary = bestmove ?? lines[0].pv[0];
    const weaker = previewWeakerMove(fen, primary, weakerLines, settings);
    if (weaker) {
      const arrows: Arrow[] = [
        {
          move: primary,
          rank: 0,
          ...(bestmove === undefined ? { provisional: true } : {}),
        },
        { move: weaker.move, rank: 1, weaker: true },
      ];
      if (settings.weakenedShowsTopMoves) {
        for (const line of lines) {
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
  if (moveChoice) {
    if (settings.weakenedShowsTopMoves) {
      return weakenedArrows(moveChoice.move, lines, WEAKER_MOVE_MULTIPV).map((arrow, rank) =>
        rank === 0 ? { ...arrow, weaker: true } : arrow,
      );
    }
    return [weakerPickArrow(moveChoice.move)];
  }
  if (isStrengthLimited(settings)) {
    return weakenedArrows(bestmove, lines, settings.weakenedShowsTopMoves ? WEAKER_MOVE_MULTIPV : 1);
  }
  return arrowsFromLines(lines, settings.weakenedShowsTopMoves ? WEAKER_MOVE_MULTIPV : settings.arrows);
}
