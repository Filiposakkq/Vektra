import { describe, expect, it } from 'vitest';
import { buildPdf } from '../src/analysis/pdfExport';
import { analyzeGame, type Analyzer } from '../src/analysis/gameAnalysis';
import { weakenedArrows } from '../src/content/hints';
import { knightCorner, squareCenter } from '../src/ui/overlay';
import type { PvLine } from '../src/engine/uci';

const line = (m: string, multipv: number): PvLine => ({ multipv, depth: 10, score: { type: 'cp', value: 0 }, pv: [m] });

describe('weakened engine arrows', () => {
  const lines = [line('e2e4', 1), line('d2d4', 2), line('g1f3', 3)];
  it('shows only the weakened pick by default', () => {
    expect(weakenedArrows('c2c4', lines, 1)).toEqual([{ move: 'c2c4', rank: 0 }]);
  });
  it('adds the real top moves after the pick, without repeating it', () => {
    expect(weakenedArrows('d2d4', lines, 3)).toEqual([
      { move: 'd2d4', rank: 0 },
      { move: 'e2e4', rank: 1 },
      { move: 'g1f3', rank: 2 },
    ]);
  });
  it('shows the current best line provisionally before the weakened pick is ready', () => {
    expect(weakenedArrows(undefined, lines, 1)).toEqual([
      { move: 'e2e4', rank: 0, provisional: true },
    ]);
    expect(weakenedArrows(null, lines, 1)).toEqual([]);
  });
});

describe('knight arrows', () => {
  it('turn at the end of the long leg', () => {
    const g1 = squareCenter('g1', false);
    expect(knightCorner(g1, squareCenter('f3', false))).toEqual(squareCenter('g3', false));
    expect(knightCorner(g1, squareCenter('e2', false))).toEqual(squareCenter('e1', false));
  });
  it('are straight for other moves', () => {
    expect(knightCorner(squareCenter('e2', false), squareCenter('e4', false))).toBeNull();
    expect(knightCorner(squareCenter('a1', false), squareCenter('c3', false))).toBeNull();
  });
});

describe('PDF export', () => {
  it('builds a report with the summary and every move', async () => {
    // A stand-in engine: every position equal, best move is the move played.
    const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
    const uci = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7'];
    let i = 0;
    const engine: Analyzer = {
      analyze: async () => ({ bestmove: uci[i] ?? null, lines: [line(uci[i++] ?? 'a1a1', 1)] }),
    };
    const a = (await analyzeGame(sans, engine, { depth: 12 }))!;
    expect(a.moves.every((m) => m.category === 'best' || m.category === 'book')).toBe(true);
    expect(a.opening).toMatch(/Ruy Lopez/);

    const doc = await buildPdf(a, { url: 'https://www.chess.com/game/live/1', date: new Date(0) });
    const raw = doc.output();
    expect(raw.startsWith('%PDF')).toBe(true);
    expect(raw).toContain('Vektra game analysis');
    expect(raw).toContain('Stockfish depth 12');
    expect(raw).toContain('O-O');
    expect(raw).toContain('Blunder');
  });
});
