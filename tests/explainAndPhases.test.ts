import { afterEach, describe, expect, it, vi } from 'vitest';
import { explainMove } from '../src/analysis/explain';
import { gameRating, summarize, type MoveAnalysis } from '../src/analysis/gameAnalysis';
import type { PositionEval } from '../src/analysis/moveAnalysis';
import { gamePhases } from '../src/analysis/phases';
import { replay } from '../src/chess/replay';
import type { Score } from '../src/engine/uci';
import { AnalysisPanel } from '../src/ui/analysisPanel';
import { installFakeChrome } from './fixtures/chrome';

/** A position with one engine line; `score` is White's view, the line's is the side to move's. */
function pos(fen: string, score: Score, pv: string[] = []): PositionEval {
  const white = fen.split(' ')[1] === 'w';
  const own: Score = { type: score.type, value: white ? score.value : -score.value };
  return { fen, score, lines: pv.length ? [{ multipv: 1, depth: 12, score: own, pv }] : [] };
}

describe('explainMove', () => {
  it('names a mate the move allows', () => {
    const { fens } = replay(['f3', 'e5', 'g4']);
    const before = pos(fens[2], { type: 'cp', value: -30 }, ['b1c3']);
    const after = pos(fens[3], { type: 'mate', value: -1 }, ['d8h4']);
    expect(explainMove(before, after, { uci: 'g2g4', color: 'w' }, 'blunder')).toBe(
      'Allows mate in 1, starting with Qh4#.',
    );
  });

  it('names a mate the move misses', () => {
    const before = pos('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', { type: 'mate', value: 1 }, ['a1a8']);
    const after = pos('6k1/5ppp/8/8/8/8/6K1/R7 b - - 1 1', { type: 'cp', value: 500 }, ['g8f8']);
    expect(explainMove(before, after, { uci: 'g1g2', color: 'w' }, 'blunder')).toBe('Misses mate in 1 with Ra8#.');
  });

  it('names the piece lost and the capture that takes it', () => {
    const before = pos('4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1', { type: 'cp', value: 900 }, ['d1d2', 'e8e7']);
    const after = pos('4k3/8/4p3/3Q4/8/8/8/4K3 b - - 1 1', { type: 'cp', value: -100 }, ['e6d5', 'e1e2']);
    expect(explainMove(before, after, { uci: 'd1d5', color: 'w' }, 'blunder')).toBe('Loses the queen on d5 to exd5.');
  });

  it('for a Miss, names what the best move would have taken', () => {
    const before = pos('q3k3/8/8/8/8/8/8/R3K3 w - - 0 1', { type: 'cp', value: 900 }, ['a1a8', 'e8e7']);
    const after = pos('q3k3/8/8/8/8/8/4K3/R7 b - - 1 1', { type: 'cp', value: -900 }, ['a8a1', 'e2d2']);
    expect(explainMove(before, after, { uci: 'e1e2', color: 'w' }, 'miss')).toBe('Misses Rxa8+, which takes the queen.');
  });

  it('gives no reason for a move that only gives up position, or for a good move', () => {
    const { fens } = replay(['e4', 'e5']);
    const before = pos(fens[2], { type: 'cp', value: 40 }, ['g1f3', 'b8c6']);
    const after = pos('rnbqkbnr/pppp1ppp/8/4p3/4P3/7P/PPPP1PP1/RNBQKBNR b KQkq - 0 2', { type: 'cp', value: -20 }, ['g8f6', 'b1c3']);
    expect(explainMove(before, after, { uci: 'h2h3', color: 'w' }, 'inaccuracy')).toBeUndefined();
    expect(explainMove(before, after, { uci: 'h2h3', color: 'w' }, 'good')).toBeUndefined();
  });
});

describe('game phases', () => {
  it('runs from the opening to the middlegame and the endgame', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    // Every piece developed: only rooks and king are left on the back ranks.
    const developed = 'r3k2r/pppppppp/2nq1n2/2b2b2/2B2B2/2NQ1N2/PPPPPPPP/R3K2R w KQkq - 0 1';
    const endgame = '4k3/pppr4/8/8/8/8/PPPR4/4K3 w - - 0 1';
    expect(gamePhases([start, start, developed, start, endgame, developed])).toEqual([
      'opening', 'opening', 'middlegame', 'middlegame', 'endgame', 'endgame',
    ]);
  });

  it('reaches the middlegame by ply 30 at the latest', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const phases = gamePhases(Array(32).fill(start));
    expect(phases[29]).toBe('opening');
    expect(phases[30]).toBe('middlegame');
  });
});

describe('game rating', () => {
  it('matches the reviewed game it was drawn through, in steps of 50', () => {
    expect(gameRating(97.5)).toBe(2650);
    expect(gameRating(80.4)).toBe(1950);
    expect(gameRating(0)).toBe(100);
    expect(gameRating(100)).toBe(2750);
  });
});

function sampleMoves(): MoveAnalysis[] {
  const sans = ['e4', 'e5', 'Qh5', 'Ke7'];
  const { fens, uci } = replay(sans);
  return sans.map((san, i) => ({
    ply: i + 1,
    color: i % 2 ? 'b' : 'w',
    san,
    uci: uci[i],
    fenBefore: fens[i],
    bestMove: uci[i],
    bestSan: san,
    bestLine: [],
    winBefore: 50,
    winAfter: i === 3 ? 10 : 50,
    loss: i === 3 ? 40 : 0,
    accuracy: i === 3 ? 5 : 100,
    category: i < 2 ? 'book' : i === 3 ? 'blunder' : 'best',
    ...(i === 3 ? { reason: 'Loses the pawn on e5 to Qxe5+.' } : {}),
  }));
}

describe('analysis panel extras', () => {
  afterEach(() => {
    document.getElementById('vektra-analysis-panel')?.remove();
    vi.unstubAllGlobals();
  });

  it('shows the game rating, the phases, the reason and a legend', () => {
    installFakeChrome({ baseUrl: '' });
    const callbacks = { onAnalyze: vi.fn(), onCancel: vi.fn(), onExport: vi.fn(), onExportPdf: vi.fn(), onSelectPly: vi.fn() };
    const panel = new AnalysisPanel(callbacks);
    const moves = sampleMoves();
    const { fens } = replay(moves.map((m) => m.san));
    const positions = fens.map((fen) => pos(fen, { type: 'cp', value: 0 }));
    panel.showResult({ sans: moves.map((m) => m.san), depth: 12, positions, moves, summary: summarize(moves) }, 4);
    const root = document.getElementById('vektra-analysis-panel')!;

    expect(root.textContent).toMatch(/Game rating ~\d+/);
    expect(root.textContent).toContain('Loses the pawn on e5 to Qxe5+.');
    expect(root.textContent).toContain('Phases');
    expect(root.textContent).toContain('Middlegame');
    expect(root.textContent).toContain('–'); // endgame not reached

    const toggle = [...root.querySelectorAll('button')].find((b) => /arrows and numbers/.test(b.textContent ?? ''))!;
    expect(root.textContent).not.toContain('Numbered arrows');
    toggle.click();
    expect(root.textContent).toContain('Numbered arrows');
    panel.destroy();
  });
});
