import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_PROFILE_VERSION,
  CACHE_SIZE,
  entryProfile,
  findCached,
  profileFor,
  reachedDepth,
  satisfies,
  usedEngine,
  withEntry,
  type AnalysisProfile,
  type CacheEntry,
} from '../src/analysis/analysisCache';
import { ANALYSIS_MAX_MOVETIME_MS, ANALYSIS_MULTIPV, LITE_ENGINE_VERSION } from '../src/analysis/config';
import type { GameAnalysis, PositionEval } from '../src/analysis/gameAnalysis';
import { FULL_ENGINE } from '../src/engine/fullEngine';

const pos = (depth: number | null): PositionEval => ({
  fen: 'fen',
  score: { type: 'cp', value: 0 },
  lines: depth === null ? [] : [{ multipv: 1, depth, score: { type: 'cp', value: 0 }, pv: ['e2e4'] }],
});

function analysis(sans: string[], depth: number, engine?: string, reached = depth): GameAnalysis {
  return {
    sans,
    engine,
    depth,
    positions: [...sans.map(() => pos(reached)), pos(null)],
    moves: [],
    summary: { w: { accuracy: 100, counts: {} as never }, b: { accuracy: 100, counts: {} as never } },
  };
}

const SANS = ['e4', 'e5', 'Qh5'];
const KEY = 'e4 e5 Qh5';
const entry = (engine: 'lite' | 'full', depth: number, sans = SANS): CacheEntry => {
  const a = analysis(sans, depth, engine === 'full' ? 'Stockfish 19' : 'Stockfish 19 lite');
  return { key: sans.join(' '), profile: profileFor(engine, depth, a.positions), analysis: a };
};
const legacy = (depth: number, engine?: string): CacheEntry => ({ key: KEY, analysis: analysis(SANS, depth, engine) });

describe('analysis profile', () => {
  it('records the engine, its version and the search settings', () => {
    const a = analysis(SANS, 14, undefined, 11);
    expect(profileFor('full', 14, a.positions)).toEqual({
      version: ANALYSIS_PROFILE_VERSION,
      engine: 'full',
      engineVersion: FULL_ENGINE.version,
      depth: 14,
      depthReached: 11,
      multipv: ANALYSIS_MULTIPV,
      movetimeMs: ANALYSIS_MAX_MOVETIME_MS,
      hashMb: 64,
    });
    expect(profileFor('lite', 14, a.positions).engineVersion).toBe(LITE_ENGINE_VERSION);
  });

  it('takes the reached depth from the shallowest searched position, skipping finished ones', () => {
    expect(reachedDepth([pos(14), pos(9), pos(null), pos(12)])).toBe(9);
    expect(reachedDepth([pos(null)])).toBe(0);
  });
});

describe('satisfies', () => {
  const base = profileFor('lite', 12, [pos(12)]);
  const with_ = (change: Partial<AnalysisProfile>) => ({ ...base, ...change });

  it('accepts the same engine at the same or a lower depth', () => {
    expect(satisfies(base, 'lite', 12)).toBe(true);
    expect(satisfies(base, 'lite', 10)).toBe(true);
    expect(satisfies(base, 'lite', 13)).toBe(false);
  });

  it('lets a full-engine analysis serve the lite engine, never the other way round', () => {
    const full = profileFor('full', 12, [pos(12)]);
    expect(satisfies(full, 'lite', 12)).toBe(true);
    expect(satisfies(full, 'full', 12)).toBe(true);
    expect(satisfies(base, 'full', 12)).toBe(false);
  });

  it('goes by the requested depth, not the depth the time cap stopped at', () => {
    expect(satisfies(with_({ depthReached: 7 }), 'lite', 12)).toBe(true);
  });

  it('rejects other engine versions, profile versions, fewer lines or a shorter time cap', () => {
    expect(satisfies(with_({ engineVersion: '18.0.0' }), 'lite', 12)).toBe(false);
    expect(satisfies(with_({ version: ANALYSIS_PROFILE_VERSION + 1 }), 'lite', 12)).toBe(false);
    expect(satisfies(with_({ version: ANALYSIS_PROFILE_VERSION - 1 }), 'lite', 12)).toBe(false);
    expect(satisfies(with_({ multipv: 1 }), 'lite', 12)).toBe(false);
    expect(satisfies(with_({ movetimeMs: ANALYSIS_MAX_MOVETIME_MS - 1 }), 'lite', 12)).toBe(false);
    expect(satisfies(with_({ multipv: 3, movetimeMs: ANALYSIS_MAX_MOVETIME_MS * 2 }), 'lite', 12)).toBe(true);
  });
});

describe('legacy cache entries', () => {
  it('treats lite and unlabelled ones as the lite engine', () => {
    for (const label of ['Stockfish 19 lite', undefined]) {
      const profile = entryProfile(legacy(12, label))!;
      expect(profile).toMatchObject({ engine: 'lite', engineVersion: LITE_ENGINE_VERSION, depth: 12, multipv: 2 });
      expect(findCached([legacy(12, label)], SANS, 'lite', 12)).toBeDefined();
      expect(findCached([legacy(12, label)], SANS, 'full', 12)).toBeUndefined();
    }
  });

  it("does not trust 'Stockfish 19' as the full engine (it may have fallen back to lite)", () => {
    const old = legacy(12, 'Stockfish 19');
    expect(entryProfile(old)?.engine).toBe('lite');
    expect(findCached([old], SANS, 'lite', 12)).toBe(old);
    expect(findCached([old], SANS, 'full', 12)).toBeUndefined();
  });

  it('skips corrupt entries instead of throwing', () => {
    const corrupt: unknown[] = [
      null,
      42,
      { key: KEY },
      { key: KEY, analysis: { sans: SANS, positions: 'x', depth: 12 } },
      { key: KEY, analysis: analysis(SANS, 12), profile: { engine: 'lite' } },
      { key: KEY, analysis: analysis(SANS, 12, 'Some other engine') },
      { ...legacy(12), analysis: { ...analysis(SANS, 12), positions: [pos(12)] } },
    ];
    for (const c of corrupt) expect(entryProfile(c)).toBeNull();
    expect(findCached(corrupt, SANS, 'lite', 1)).toBeUndefined();
    expect(findCached('not a list', SANS, 'lite', 1)).toBeUndefined();
    expect(findCached(undefined, SANS, 'lite', 1)).toBeUndefined();
  });
});

describe('findCached', () => {
  it('matches the exact game only', () => {
    const cache = [entry('lite', 12)];
    expect(findCached(cache, SANS, 'lite', 12)).toBe(cache[0]);
    expect(findCached(cache, ['e4', 'e5'], 'lite', 12)).toBeUndefined();
    expect(findCached(cache, [...SANS, 'Nc6'], 'lite', 12)).toBeUndefined();
  });

  it('re-analyses when the saved analysis is shallower than the current depth', () => {
    expect(findCached([entry('lite', 10)], SANS, 'lite', 12)).toBeUndefined();
  });

  it('prefers an analysis made with the selected engine', () => {
    const lite = entry('lite', 12);
    const full = entry('full', 12);
    expect(findCached([full, lite], SANS, 'lite', 12)).toBe(lite);
    expect(findCached([lite, full], SANS, 'full', 12)).toBe(full);
    expect(findCached([full], SANS, 'lite', 12)).toBe(full);
  });
});

describe('withEntry', () => {
  it('puts the new analysis first and replaces only the same game with the same engine', () => {
    const otherGame = entry('lite', 12, ['d4']);
    const oldLite = legacy(10, 'Stockfish 19 lite');
    const full = entry('full', 12);
    const lite = entry('lite', 14);
    expect(withEntry([otherGame, oldLite, full], lite)).toEqual([lite, otherGame, full]);
  });

  it('keeps at most CACHE_SIZE entries', () => {
    const cache = Array.from({ length: CACHE_SIZE }, (_, i) => entry('lite', 12, [`m${i}`]));
    const next = withEntry(cache, entry('lite', 12));
    expect(next).toHaveLength(CACHE_SIZE);
    expect((next[0] as CacheEntry).key).toBe(KEY);
    expect(next).not.toContain(cache[CACHE_SIZE - 1]);
  });

  it('starts a new cache when the stored value is not a list', () => {
    const e = entry('lite', 12);
    expect(withEntry(undefined, e)).toEqual([e]);
    expect(withEntry({ broken: true }, e)).toEqual([e]);
  });
});

describe('usedEngine', () => {
  it('is full only when full was selected and every engine that searched was full', () => {
    expect(usedEngine(['full', 'full'], 'full')).toBe('full');
    expect(usedEngine(['full', null], 'full')).toBe('full');
    expect(usedEngine(['full', 'lite'], 'full')).toBe('lite');
    expect(usedEngine(['lite'], 'full')).toBe('lite');
    expect(usedEngine([null, null], 'full')).toBe('lite');
    expect(usedEngine(['lite'], 'lite')).toBe('lite');
  });
});
