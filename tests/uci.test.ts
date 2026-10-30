import { describe, expect, it } from 'vitest';
import { formatScore, parseBestMove, parseInfo, scoreToCp, whitePov } from '../src/engine/uci';
import { winPercent, winPercentFromCp } from '../src/analysis/winProbability';

describe('UCI parsing', () => {
  it('parses a multipv info line', () => {
    const line =
      'info depth 10 seldepth 16 multipv 2 score cp 44 nodes 33951 nps 414036 hashfull 5 time 82 pv b1c3 g8f6 d2d4';
    expect(parseInfo(line)).toEqual({
      multipv: 2,
      depth: 10,
      score: { type: 'cp', value: 44 },
      pv: ['b1c3', 'g8f6', 'd2d4'],
    });
  });

  it('parses mate scores and defaults multipv to 1', () => {
    expect(parseInfo('info depth 5 score mate -2 pv e1e2 d8h4')).toMatchObject({
      multipv: 1,
      score: { type: 'mate', value: -2 },
    });
  });

  it('ignores lines without a pv and bound-only scores', () => {
    expect(parseInfo('info depth 3 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfo('info depth 9 score cp 30 lowerbound nodes 1 pv e2e4')).toBeNull();
    expect(parseInfo('info string NNUE evaluation using nn.bin')).toBeNull();
  });

  it('parses bestmove', () => {
    expect(parseBestMove('bestmove d2d4 ponder e5d4')).toBe('d2d4');
    expect(parseBestMove('bestmove e7e8q')).toBe('e7e8q');
    expect(parseBestMove('bestmove (none)')).toBeNull();
    expect(parseBestMove('readyok')).toBeUndefined();
  });

  it('converts scores', () => {
    expect(whitePov({ type: 'cp', value: 50 }, 'b')).toEqual({ type: 'cp', value: -50 });
    expect(scoreToCp({ type: 'mate', value: 3 })).toBe(9997);
    expect(scoreToCp({ type: 'mate', value: -1 })).toBe(-9999);
    expect(formatScore({ type: 'cp', value: 52 })).toBe('+0.52');
    expect(formatScore({ type: 'cp', value: -130 })).toBe('-1.30');
    expect(formatScore({ type: 'mate', value: -2 })).toBe('-M2');
  });
});

describe('win probability', () => {
  it('follows the logistic curve', () => {
    expect(winPercentFromCp(0)).toBe(50);
    expect(winPercentFromCp(100)).toBeCloseTo(59.1, 1);
    expect(winPercentFromCp(-100)).toBeCloseTo(40.9, 1);
    expect(winPercent({ type: 'mate', value: 2 })).toBe(100);
    expect(winPercent({ type: 'mate', value: -2 })).toBe(0);
  });
});
