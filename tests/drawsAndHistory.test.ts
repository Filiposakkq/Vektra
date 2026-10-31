import { describe, expect, it } from 'vitest';
import { replay } from '../src/chess/replay';
import {
  buildRequest,
  drawAvoidingLine,
  drawsAfter,
  extendHistory,
  searchHistory,
  type GameHistory,
} from '../src/content/hints';
import { biggestMistake } from '../src/content/analysisController';
import type { MoveAnalysis } from '../src/analysis/moveAnalysis';
import type { PvLine } from '../src/engine/uci';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { segmentsOverlap } from '../src/ui/overlay';

const game = (sans: string[]): GameHistory => {
  const { fens, uci } = replay(sans);
  return { fens, uci };
};
const line = (move: string, multipv: number, value: number): PvLine => ({
  multipv,
  depth: 12,
  score: { type: 'cp', value },
  pv: [move],
});

// Knights out and back twice: one more Ng1 repeats the start position a third time.
const SHUFFLE = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6'];

describe('game history for the engine', () => {
  it('sends the moves since the last capture or pawn move', () => {
    const history = searchHistory(game(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']));
    // e5 was the last pawn move: start there.
    expect(history.startFen).toBe(game(['e4', 'e5']).fens[2]);
    expect(history.moves).toEqual(['g1f3', 'b8c6', 'f1b5']);
    expect(searchHistory(game([])).moves).toEqual([]);
  });

  it('puts it in the engine request', () => {
    const g = game(['e4', 'e5', 'Nf3']);
    const req = buildRequest(g.fens[3], DEFAULT_SETTINGS, g);
    expect(req.history).toEqual({ startFen: g.fens[2], moves: ['g1f3'] });
    expect(buildRequest(g.fens[3], DEFAULT_SETTINGS).history).toBeUndefined();
  });

  it('extends the same way the next position would be read', () => {
    const g = extendHistory(game(['e4', 'e5']), 'g1f3')!;
    expect(searchHistory(g)).toEqual(searchHistory(game(['e4', 'e5', 'Nf3'])));
  });
});

describe('avoiding draws', () => {
  it('knows a move that repeats the position a third time', () => {
    expect(drawsAfter(game(SHUFFLE), 'f3g1')).toBe(true);
    expect(drawsAfter(game(SHUFFLE), 'e2e4')).toBe(false);
  });

  it('knows stalemate', () => {
    // White to move: Qb6 stalemates the black king on a8.
    const { fens, uci } = replay([], 'k7/8/2Q5/8/8/8/8/K7 w - - 0 1');
    expect(drawsAfter({ fens, uci }, 'c6b6')).toBe(true);
    expect(drawsAfter({ fens, uci }, 'c6c8')).toBe(false);
  });

  it('picks the best line that keeps the game going about level', () => {
    const lines = [line('f3g1', 1, 0), line('e2e4', 2, -20), line('d2d4', 3, -25)];
    expect(drawAvoidingLine(game(SHUFFLE), lines, 'f3g1')?.pv[0]).toBe('e2e4');
  });

  it('keeps the draw when every alternative is clearly worse', () => {
    const lines = [line('f3g1', 1, 0), line('e2e4', 2, -150)];
    expect(drawAvoidingLine(game(SHUFFLE), lines, 'f3g1')).toBeNull();
  });

  it('does nothing when the best move does not draw', () => {
    const lines = [line('e2e4', 1, 30), line('d2d4', 2, 20)];
    expect(drawAvoidingLine(game(['Nf3']), lines, 'e2e4')).toBeNull();
  });
});

describe('threat arrows next to move arrows', () => {
  it('overlap only along the same line', () => {
    expect(segmentsOverlap([[0.5, 7.5], [0.5, 3.5]], [[0.5, 6.5], [0.5, 4.5]])).toBe(true);
    expect(segmentsOverlap([[0.5, 7.5], [0.5, 3.5]], [[0.5, 4.5], [0.5, 7.5]])).toBe(true);
    expect(segmentsOverlap([[0.5, 7.5], [0.5, 3.5]], [[1.5, 7.5], [1.5, 3.5]])).toBe(false);
    expect(segmentsOverlap([[0.5, 7.5], [0.5, 3.5]], [[0.5, 7.5], [3.5, 4.5]])).toBe(false);
    expect(segmentsOverlap([[0.5, 7.5], [0.5, 5.5]], [[0.5, 4.5], [0.5, 2.5]])).toBe(false);
  });
});

describe('review', () => {
  it("finds the player's biggest mistake", () => {
    const move = (ply: number, color: 'w' | 'b', category: MoveAnalysis['category'], loss: number) =>
      ({ ply, color, category, loss }) as MoveAnalysis;
    const moves = [move(1, 'w', 'best', 0), move(2, 'b', 'blunder', 40), move(3, 'w', 'mistake', 15), move(5, 'w', 'inaccuracy', 8)];
    expect(biggestMistake(moves, 'w')?.ply).toBe(3);
    expect(biggestMistake(moves, 'b')?.ply).toBe(2);
    expect(biggestMistake([move(1, 'w', 'best', 0)], 'w')).toBeNull();
  });
});
