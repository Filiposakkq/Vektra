import { describe, expect, it } from 'vitest';
import { CLASSIFICATION } from '../src/analysis/config';
import { WIN_PROB_K, winPercentFromCp } from '../src/analysis/winProbability';

describe('win probability curve', () => {
  it('has a single steepness, defined in config.ts', () => {
    expect(CLASSIFICATION.WIN_PROB_K).toBe(0.00368208);
    expect(WIN_PROB_K).toBe(CLASSIFICATION.WIN_PROB_K);
  });

  it('uses it by default', () => {
    expect(winPercentFromCp(250)).toBe(winPercentFromCp(250, CLASSIFICATION.WIN_PROB_K));
  });
});
