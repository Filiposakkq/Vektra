import { describe, expect, it } from 'vitest';
import type { PvLine } from '@core/engine/uci';
import { hintArrows, threatWorthShowing } from '@core/hints/hintArrows';
import { DEFAULT_SETTINGS } from '@core/settings';

const line = (move: string, cp: number, multipv = 1): PvLine => ({ multipv, depth: 12, score: { type: 'cp', value: cp }, pv: [move] });
const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('threats', () => {
  it('shows a threat only when allowing it would cost enough win chance', () => {
    // Level now; after the opponent's free move it is up a piece: worth showing.
    expect(threatWorthShowing([line('e7e5', 0)], { move: 'd1h5', score: { type: 'cp', value: 300 } }, DEFAULT_SETTINGS)).toBe(true);
    // The free move gains almost nothing: not worth showing.
    expect(threatWorthShowing([line('e7e5', 0)], { move: 'g1f3', score: { type: 'cp', value: 20 } }, DEFAULT_SETTINGS)).toBe(false);
    expect(threatWorthShowing([], { move: 'd1h5', score: { type: 'cp', value: 300 } }, DEFAULT_SETTINGS)).toBe(false);
    expect(threatWorthShowing([line('e7e5', 0)], null, DEFAULT_SETTINGS)).toBe(false);
  });

  it('puts the threat first, then the scored move arrows', () => {
    const arrows = hintArrows({
      kind: 'game',
      fen,
      settings: DEFAULT_SETTINGS,
      lines: [line('e7e5', 0), line('d7d5', -10, 2)],
      weakerLines: [],
      bestmove: 'e7e5',
      moveChoice: null,
      threat: { move: 'd1h5', score: { type: 'cp', value: 300 } },
      showMoves: true,
    });
    expect(arrows.map((a) => [a.move, a.threat ?? false])).toEqual([
      ['d1h5', true],
      ['e7e5', false],
      ['d7d5', false],
    ]);
    expect(arrows[1].label).toBeDefined();
  });

  it('shows only the threat when the moves are hidden, and marks a running search provisional', () => {
    const base = {
      kind: 'game' as const,
      fen,
      settings: DEFAULT_SETTINGS,
      lines: [line('e7e5', 0)],
      weakerLines: [],
      moveChoice: null,
      threat: { move: 'd1h5', score: { type: 'cp' as const, value: 300 } },
    };
    expect(hintArrows({ ...base, bestmove: 'e7e5', showMoves: false }).map((a) => a.move)).toEqual(['d1h5']);
    expect(hintArrows({ ...base, bestmove: undefined, showMoves: true })[1].provisional).toBe(true);
  });
});
