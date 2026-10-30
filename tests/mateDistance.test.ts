import { describe, expect, it } from 'vitest';
import { analyzeMove } from '../src/analysis/gameAnalysis';

// Position scores are from White's side; line scores from the side to move.
const KQ = '6k1/5Q2/6K1/8/8/8/8/8 w - - 0 1';
const after = '6k1/8/6K1/8/8/8/5Q2/8 b - - 1 1';
const mate = (value: number, fen: string, pv: string[] = []) => ({
  fen,
  score: { type: 'mate' as const, value },
  lines: pv.length ? [{ score: { type: 'mate' as const, value }, pv, multipv: 1, depth: 16 }] : [],
});

describe('mate distance', () => {
  it('costs the mating side when a short mate becomes a long one', () => {
    const m = analyzeMove(mate(1, KQ, ['f7g7']), mate(11, after), { ply: 1, san: 'Qf2', uci: 'f7f2' }, { book: false });
    expect(m.loss).toBeGreaterThan(15);
    expect(m.accuracy).toBeLessThan(50);
  });

  it('does not matter to the side being mated', () => {
    const lost = '6k1/8/6K1/8/8/8/5Q2/8 b - - 0 1';
    const m = analyzeMove(mate(3, lost, ['g8h8']), mate(9, '7k/8/6K1/8/8/8/5Q2/8 w - - 1 2'), { ply: 2, san: 'Kh8', uci: 'g8h8' }, { book: false });
    expect(m.loss).toBe(0);
  });
});
