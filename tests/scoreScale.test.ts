import { describe, expect, it } from 'vitest';
import { displayWinPercent, ratingCp, ratingWinPercent } from '../src/analysis/scoreScale';
import { winPercent, winPercentFromCp } from '../src/analysis/winProbability';
import type { Score } from '../src/engine/uci';

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });

// Pinned to what the conversions returned before they were named here.
describe('display scale', () => {
  it('is winPercent: any forced mate is 100% or 0%', () => {
    for (const score of [mate(1), mate(3), mate(11), mate(30), mate(-1), mate(-11), cp(0), cp(130), cp(-480), cp(2000)]) {
      expect(displayWinPercent(score)).toBe(winPercent(score));
    }
    expect(displayWinPercent(mate(11))).toBe(100);
    expect(displayWinPercent(mate(-11))).toBe(0);
    expect(displayWinPercent(cp(100))).toBeCloseTo(59.1, 1);
  });

  it('plots mate in 11 above a +5.00 position', () => {
    expect(displayWinPercent(mate(11))).toBeGreaterThan(displayWinPercent(cp(500)));
  });
});

describe('rating scale', () => {
  it('steps a mate down by 2% per extra move, to an 80% floor, for the side that has it', () => {
    expect(ratingWinPercent(mate(1), 'w')).toBe(100);
    expect(ratingWinPercent(mate(3), 'w')).toBe(96);
    expect(ratingWinPercent(mate(11), 'w')).toBe(80);
    expect(ratingWinPercent(mate(30), 'w')).toBe(80);
    expect(ratingWinPercent(mate(-3), 'b')).toBe(96);
    expect(ratingWinPercent(mate(-3), 'w')).toBe(0);
    expect(ratingWinPercent(mate(3), 'b')).toBe(0);
    expect(ratingWinPercent(mate(0), 'w')).toBe(0);
    expect(ratingWinPercent(mate(0), 'b')).toBe(0);
  });

  it('uses the logistic curve for centipawns, from the mover side', () => {
    expect(ratingWinPercent(cp(130), 'w')).toBe(winPercentFromCp(130));
    expect(ratingWinPercent(cp(130), 'b')).toBe(100 - winPercentFromCp(130));
    expect(ratingWinPercent(cp(0), 'b')).toBe(50);
  });

  it('turns mate in N into 10000 - 100 N centipawns for comparing lines', () => {
    expect(ratingCp(cp(35), 'w')).toBe(35);
    expect(ratingCp(cp(35), 'b')).toBe(-35);
    expect(ratingCp(mate(3), 'w')).toBe(9700);
    expect(ratingCp(mate(3), 'b')).toBe(-9700);
    expect(ratingCp(mate(-2), 'w')).toBe(-9800);
    expect(ratingCp(mate(-2), 'b')).toBe(9800);
    expect(ratingCp(mate(0), 'w')).toBe(-10000);
  });
});
