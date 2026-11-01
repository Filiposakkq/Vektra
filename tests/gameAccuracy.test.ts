import { describe, expect, it } from 'vitest';
import { moveAccuracy } from '../src/analysis/classify';
import { moveWeights, summarize, type MoveAnalysis } from '../src/analysis/gameAnalysis';

/** A game of `n` plies; `losses` maps a ply (1-based) to the mover's win % loss. */
function game(n: number, losses: Record<number, number> = {}): MoveAnalysis[] {
  let white = 50;
  return Array.from({ length: n }, (_, i) => {
    const ply = i + 1;
    const color = ply % 2 ? 'w' : 'b';
    const loss = losses[ply] ?? 0;
    const winBefore = color === 'w' ? white : 100 - white;
    const winAfter = winBefore - loss;
    white = color === 'w' ? winAfter : 100 - winAfter;
    return {
      ply, color, san: 'x', uci: 'a1a2', fenBefore: '', bestMove: null, bestSan: null, bestLine: [],
      winBefore, winAfter, loss, accuracy: moveAccuracy(loss),
      category: loss > 20 ? 'blunder' : loss > 2 ? 'good' : 'best',
    } satisfies MoveAnalysis;
  });
}

describe('game accuracy', () => {
  it('is 100 for a game without losses', () => {
    const sum = summarize(game(40));
    expect(sum.w.accuracy).toBeCloseTo(100, 0);
    expect(sum.b.accuracy).toBeCloseTo(100, 0);
  });

  it('two moves that throw the game away pull it down without sinking it', () => {
    // Like a chess.com Game Review that gave 84.9 to a side with a blunder
    // and a missed queen (the old harmonic mean said 17).
    const sum = summarize(game(88, { 32: 55, 58: 80 }));
    expect(sum.b.accuracy).toBeGreaterThan(70);
    expect(sum.b.accuracy).toBeLessThan(95);
    expect(sum.w.accuracy).toBeCloseTo(100, 0);
  });

  it('weighs a move by the swings before it, not its own', () => {
    const weights = moveWeights(game(40, { 20: 60 }));
    // The blunder itself sits in a quiet stretch; the moves after it don't.
    expect(weights[19]).toBe(0.5);
    expect(weights[20]).toBeGreaterThan(5);
  });
});
