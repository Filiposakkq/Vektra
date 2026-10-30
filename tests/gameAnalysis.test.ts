import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import { analysisToJson } from '../src/analysis/export';
import { analyzeGame, type Analyzer } from '../src/analysis/gameAnalysis';
import type { AnalyzeRequest } from '../src/engine/protocol';
import { UciEngine } from '../src/engine/uciEngine';

const require = createRequire(import.meta.url);
const listeners: ((l: string) => void)[] = [];
const sf = require('stockfish')('lite-single', (l: string) => listeners.forEach((f) => f(l)));
const engine = new UciEngine((cmd) => sf.processCommand(cmd));
listeners.push((l) => engine.handleLine(l));
afterAll(() => sf.terminate?.());

describe('analyzeGame with Stockfish', { timeout: 120000 }, () => {
  it('uses a larger transposition table for full-game analysis', async () => {
    const requests: AnalyzeRequest[] = [];
    const analyzer: Analyzer = {
      analyze: async (req) => {
        requests.push(req);
        return { bestmove: null, lines: [] };
      },
    };
    const result = await analyzeGame(['e4'], analyzer, { depth: 8 });

    expect(result).not.toBeNull();
    expect(requests).toHaveLength(2);
    expect(requests.every(({ hashMb }) => hashMb === 64)).toBe(true);
    // The analysis cache records these settings (see analysisCache.ts).
    expect(requests.every(({ multipv, limit }) => multipv === 2 && limit.movetimeMs === 15000)).toBe(true);
  });

  it("classifies Scholar's mate", async () => {
    const sans = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
    const progress: number[] = [];
    const a = await analyzeGame(sans, engine, { depth: 10, onProgress: (d) => progress.push(d) });
    expect(a).not.toBeNull();
    expect(progress.at(-1)).toBe(8);
    expect(a!.positions).toHaveLength(8);
    // Final position: White has mated.
    expect(a!.positions[7].score).toEqual({ type: 'mate', value: 1 });

    const nf6 = a!.moves[5];
    expect(nf6.san).toBe('Nf6');
    expect(nf6.category).toBe('blunder');
    expect(nf6.bestSan).toMatch(/^(g6|Qe7|Qf6)$/);

    expect(a!.moves[6]).toMatchObject({ san: 'Qxf7#', category: 'best', winAfter: 100 });
    expect(a!.summary.b.counts.blunder).toBeGreaterThanOrEqual(1);
    expect(a!.summary.w.accuracy).toBeGreaterThan(a!.summary.b.accuracy);

    const json = analysisToJson(a!, { generatedAt: 'x', url: 'u' });
    expect(json.moves).toHaveLength(7);
    expect(json.moves[5]).toMatchObject({ san: 'Nf6', classification: 'Blunder', color: 'black', moveNumber: 3 });
    expect(json.moves[6].evalAfter).toEqual({ mate: 1 });
    expect(json.summary.black.counts.blunder).toBeGreaterThanOrEqual(1);
  });

  it('can be cancelled', async () => {
    const abort = new AbortController();
    const run = analyzeGame(['e4', 'e5', 'Nf3', 'Nc6'], engine, {
      depth: 10,
      signal: abort.signal,
      onProgress: () => abort.abort(),
    });
    expect(await run).toBeNull();
  });

  it('splits the game across several engines and reports moves as they are rated', async () => {
    // The node build of Stockfish is a single instance, so two "engines" share
    // it through a lock; this still checks how the work is split and merged.
    let lock: Promise<unknown> = Promise.resolve();
    const shared: Analyzer = {
      analyze: (req) => {
        const run = lock.then(() => engine.analyze(req));
        lock = run.catch(() => {});
        return run;
      },
    };
    const second: Analyzer = { analyze: (req) => shared.analyze(req) };
    const sans = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
    const partials: number[] = [];
    const a = await analyzeGame(sans, [shared, second], {
      depth: 10,
      onPartial: (moves) => partials.push(moves.filter(Boolean).length),
    });
    expect(a!.positions).toHaveLength(8);
    expect(a!.moves[5].category).toBe('blunder');
    expect(partials.at(-1)).toBe(7);
    expect(partials).not.toContain(0);
    expect(partials).toEqual([...partials].sort((x, y) => x - y));
  });
});
