import type { Score } from '../engine/uci';
import { CLASSIFICATION } from './config';
import { winPercent } from './winProbability';

/**
 * The two ways an engine score becomes a number, on purpose:
 *
 * - Display (eval graph, PDF graph, eval bar): how good the position is. Any
 *   forced mate is a won position, so it shows as 100% (or 0%).
 * - Rating (move classification and accuracy): what a move cost. Letting a
 *   mate in 3 slip into a mate in 11 is a mistake, so a mate counts for less
 *   the further away it is, down to MATE_FLOOR (80%).
 *
 * Plotting the rating scale would be wrong: mate in 11 at 80% would sit
 * below a +5.00 position (about 86%).
 */

/** Win % (0-100) for White from a White-POV score, for display; mate is 100 or 0. */
export function displayWinPercent(score: Score): number {
  return winPercent(score);
}

/**
 * Win % (0-100) for `color` from a White-POV score, for rating moves: mate
 * in N counts as 100 - MATE_STEP * (N - 1), down to MATE_FLOOR.
 */
export function ratingWinPercent(score: Score, color: 'w' | 'b'): number {
  if (score.type === 'mate') {
    // Only the side that has the mate cares how far away it is.
    const mine = color === 'w' ? score.value : -score.value;
    if (mine <= 0) return 0;
    return Math.max(CLASSIFICATION.MATE_FLOOR, 100 - CLASSIFICATION.MATE_STEP * (mine - 1));
  }
  const w = winPercent(score);
  return color === 'w' ? w : 100 - w;
}

/**
 * Centipawns for `color` from a White-POV score, for comparing engine lines
 * when rating moves: mate in N is 10000 - 100 * N, so slower mates score as
 * worse.
 */
export function ratingCp(score: Score, color: 'w' | 'b'): number {
  const cp =
    score.type === 'cp' ? score.value : Math.sign(score.value || -1) * (10000 - 100 * Math.abs(score.value));
  return color === 'w' ? cp : -cp;
}
