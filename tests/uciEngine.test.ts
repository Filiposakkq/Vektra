import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import type { AnalyzeRequest } from '../src/engine/protocol';
import { UciEngine } from '../src/engine/uciEngine';

/** Runs the real Stockfish (lite, single-threaded) build from npm under Node. */
const require = createRequire(import.meta.url);
const lines: ((l: string) => void)[] = [];
const sf = require('stockfish')('lite-single', (l: string) => lines.forEach((f) => f(l)));
const engine = new UciEngine((cmd) => sf.processCommand(cmd));
lines.push((l) => engine.handleLine(l));
afterAll(() => sf.terminate?.());

const req = (fen: string, extra: Partial<AnalyzeRequest> = {}): AnalyzeRequest => ({
  fen,
  multipv: 3,
  limit: { depth: 8 },
  strength: { skillLevel: 20, limitStrength: false, elo: 2000 },
  ...extra,
});

describe('UciEngine with Stockfish', { timeout: 60000 }, () => {
  it('returns ranked multipv lines and a best move', async () => {
    const updates: number[] = [];
    const r = await engine.analyze(
      req('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'),
      (l) => updates.push(l[0].depth),
    );
    expect(r?.lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
    expect(r?.lines[0].depth).toBe(8);
    expect(r?.bestmove).toBe(r?.lines[0].pv[0]);
    expect(updates.length).toBeGreaterThan(1);
  });

  it('finds mate in one', async () => {
    const r = await engine.analyze(req('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', { multipv: 1 }));
    expect(r?.bestmove).toBe('a1a8');
    expect(r?.lines[0].score).toEqual({ type: 'mate', value: 1 });
  });

  it('accepts a larger transposition table for analysis searches', async () => {
    const r = await engine.analyze(
      req('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', {
        multipv: 1,
        hashMb: 64,
      }),
    );
    expect(r?.lines[0].depth).toBe(8);
  });

  it('reports no move when the side to move is mated', async () => {
    const r = await engine.analyze(req('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'));
    expect(r?.bestmove).toBeNull();
  });

  it('a newer search supersedes the running one', async () => {
    const first = engine.analyze(req('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { limit: { depth: 30 } }));
    const second = engine.analyze(req('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', { multipv: 1 }));
    expect(await first).toBeNull();
    expect((await second)?.bestmove).toBe('a1a8');
  });

  it('plays a weakened move with UCI_LimitStrength', async () => {
    const r = await engine.analyze(
      req('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', {
        multipv: 1,
        strength: { skillLevel: 20, limitStrength: true, elo: 1320 },
      }),
    );
    expect(r?.bestmove).toMatch(/^[a-h][1-8][a-h][1-8]$/);
  });

  it('applies the Elo limit without overriding the requested search depth', async () => {
    const r = await engine.analyze(
      req('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', {
        multipv: 1,
        limit: { depth: 10 },
        strength: { skillLevel: 20, limitStrength: true, elo: 1400 },
      }),
    );
    expect(r?.lines[0].depth).toBe(10);
    expect(r?.bestmove).toMatch(/^[a-h][1-8][a-h][1-8]$/);
  });
});
