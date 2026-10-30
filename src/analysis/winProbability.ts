import { scoreToCp, type Score } from '../engine/uci';
import { CLASSIFICATION } from './config';

/**
 * Steepness of the logistic curve from centipawns to win %, for the side the
 * score is for. Defined once, in config.ts.
 */
export const WIN_PROB_K = CLASSIFICATION.WIN_PROB_K;

export function winPercentFromCp(cp: number, k: number = WIN_PROB_K): number {
  return 50 + 50 * (2 / (1 + Math.exp(-k * cp)) - 1);
}

export function winPercent(score: Score, k: number = WIN_PROB_K): number {
  if (score.type === 'mate') return score.value > 0 ? 100 : 0;
  return winPercentFromCp(scoreToCp(score), k);
}
