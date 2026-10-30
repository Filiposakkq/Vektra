import { FULL_ENGINE } from '../engine/fullEngine';
import {
  ANALYSIS_HASH_MB,
  ANALYSIS_MAX_MOVETIME_MS,
  ANALYSIS_MULTIPV,
  LITE_ENGINE_VERSION,
} from './config';
import type { GameAnalysis, PositionEval } from './gameAnalysis';

/**
 * Rules for reusing saved full-game analyses. Each saved analysis records the
 * engine and search settings it was made with (its profile), and is only
 * shown again when those still cover what a new analysis would use.
 */

/**
 * Bump when a change to the search settings would change the ratings, so
 * analyses saved before it are run again.
 */
export const ANALYSIS_PROFILE_VERSION = 1;
/** Analyses saved before profiles existed count as this version. */
const LEGACY_PROFILE_VERSION = 1;

export const CACHE_SIZE = 12;

export type EngineKind = 'lite' | 'full';

export interface AnalysisProfile {
  version: number;
  engine: EngineKind;
  engineVersion: string;
  /** Depth the analysis asked for. */
  depth: number;
  /** Lowest depth any position actually reached (the time cap can stop one short). For information only. */
  depthReached: number;
  multipv: number;
  /** Longest search per position, in ms. */
  movetimeMs: number;
  hashMb: number;
}

export interface CacheEntry {
  key: string;
  /** Missing on analyses saved before profiles existed. */
  profile?: AnalysisProfile;
  analysis: GameAnalysis;
}

export const cacheKey = (sans: readonly string[]) => sans.join(' ');

export const engineVersion = (engine: EngineKind) => (engine === 'full' ? FULL_ENGINE.version : LITE_ENGINE_VERSION);

/** Engine name shown on the panel and in exports. */
export const engineLabel = (engine: EngineKind) => (engine === 'full' ? 'Stockfish 19' : 'Stockfish 19 lite');

/**
 * Engine an analysis was actually made with: full only if it was selected and
 * every engine that searched reported the full one (asking for it falls back
 * to lite when it isn't downloaded). Engines that never searched report null.
 */
export function usedEngine(reported: readonly (EngineKind | null)[], selected: EngineKind): EngineKind {
  const known = reported.filter((e) => e !== null);
  return selected === 'full' && known.length > 0 && known.every((e) => e === 'full') ? 'full' : 'lite';
}

/** Lowest depth reached over the positions the engine searched (0 if none). */
export function reachedDepth(positions: readonly PositionEval[]): number {
  const depths = positions.filter((p) => p.lines.length).map((p) => p.lines[0].depth);
  return depths.length ? Math.min(...depths) : 0;
}

/** Profile of an analysis just made with `engine` and the current search settings. */
export function profileFor(engine: EngineKind, depth: number, positions: readonly PositionEval[]): AnalysisProfile {
  return {
    version: ANALYSIS_PROFILE_VERSION,
    engine,
    engineVersion: engineVersion(engine),
    depth,
    depthReached: reachedDepth(positions),
    multipv: ANALYSIS_MULTIPV,
    movetimeMs: ANALYSIS_MAX_MOVETIME_MS,
    hashMb: ANALYSIS_HASH_MB,
  };
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isAnalysis(v: unknown): v is GameAnalysis {
  const a = v as GameAnalysis | null;
  return (
    !!a &&
    typeof a === 'object' &&
    Array.isArray(a.sans) &&
    Array.isArray(a.positions) &&
    a.positions.length === a.sans.length + 1 &&
    a.positions.every((p) => !!p && typeof p.fen === 'string' && Array.isArray(p.lines)) &&
    isNumber(a.depth)
  );
}

function isProfile(v: unknown): v is AnalysisProfile {
  const p = v as AnalysisProfile | null;
  return (
    !!p &&
    typeof p === 'object' &&
    (p.engine === 'lite' || p.engine === 'full') &&
    typeof p.engineVersion === 'string' &&
    [p.version, p.depth, p.depthReached, p.multipv, p.movetimeMs, p.hashMb].every(isNumber)
  );
}

/**
 * The profile of a saved entry, or null if the entry can't be used. Entries
 * from before profiles existed were all made with the lite engine's version
 * and MultiPV 2. One labelled 'Stockfish 19' may still have come from the
 * lite engine (selecting the full engine fell back to lite without saying
 * so), so it only counts as lite.
 */
export function entryProfile(entry: unknown): AnalysisProfile | null {
  const e = entry as CacheEntry | null;
  if (!e || typeof e !== 'object' || typeof e.key !== 'string' || !isAnalysis(e.analysis)) return null;
  if (e.profile !== undefined) return isProfile(e.profile) ? e.profile : null;
  const label = e.analysis.engine;
  if (label !== undefined && label !== 'Stockfish 19 lite' && label !== 'Stockfish 19') return null;
  return {
    version: LEGACY_PROFILE_VERSION,
    engine: 'lite',
    engineVersion: LITE_ENGINE_VERSION,
    depth: e.analysis.depth,
    depthReached: reachedDepth(e.analysis.positions),
    multipv: 2,
    movetimeMs: ANALYSIS_MAX_MOVETIME_MS,
    hashMb: ANALYSIS_HASH_MB,
  };
}

/**
 * True if an analysis with this profile is as good as a new one with
 * `engine` at `depth` would be. A full-engine analysis also serves the lite
 * engine; a lite one never serves the full engine. Depth is the depth asked
 * for: under the same time cap a new search stops where the saved one did.
 */
export function satisfies(profile: AnalysisProfile, engine: EngineKind, depth: number): boolean {
  return (
    profile.version === ANALYSIS_PROFILE_VERSION &&
    profile.engineVersion === engineVersion(profile.engine) &&
    (profile.engine === engine || (profile.engine === 'full' && engine === 'lite')) &&
    profile.multipv >= ANALYSIS_MULTIPV &&
    profile.movetimeMs >= ANALYSIS_MAX_MOVETIME_MS &&
    profile.depth >= depth
  );
}

const asEntries = (cache: unknown): unknown[] => (Array.isArray(cache) ? cache : []);

/**
 * The saved analysis of this game to show for `engine` at `depth`, if any.
 * One made with the selected engine wins over one made with a stronger engine.
 */
export function findCached(
  cache: unknown,
  sans: readonly string[],
  engine: EngineKind,
  depth: number,
): CacheEntry | undefined {
  const key = cacheKey(sans);
  const usable = asEntries(cache).filter((entry): entry is CacheEntry => {
    if ((entry as CacheEntry | null)?.key !== key) return false;
    const profile = entryProfile(entry);
    return !!profile && satisfies(profile, engine, depth);
  });
  return usable.find((e) => entryProfile(e)!.engine === engine) ?? usable[0];
}

/**
 * The cache with `entry` first, replacing an earlier analysis of the same
 * game with the same engine, and keeping at most `size` entries.
 */
export function withEntry(cache: unknown, entry: CacheEntry, size = CACHE_SIZE): unknown[] {
  const engine = entry.profile?.engine;
  const rest = asEntries(cache).filter(
    (e) => (e as CacheEntry | null)?.key !== entry.key || entryProfile(e)?.engine !== engine,
  );
  return [entry, ...rest].slice(0, size);
}
