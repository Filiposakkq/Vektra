import { scoreToCp, type PvLine } from '../engine/uci';
import { uciToSan } from '../analysis/chessNotation';
import type { Settings } from '../shared/settings';
import type { Arrow } from '../ui/overlay';

/* Occasional weaker moves: the playable alternatives, and which one to pick. */

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
