/**
 * Vektra's settings: what each one is, its default, and how a stored value is
 * checked. Where they are stored is up to each platform.
 */
export interface Settings {
  enabled: boolean;
  /** Stockfish "Skill Level", 0-20. Ignored when limitStrength is on. */
  skillLevel: number;
  /** Use UCI_LimitStrength / UCI_Elo instead of Skill Level. */
  limitStrength: boolean;
  /** 1320-3190. */
  elo: number;
  /**
   * With a weakened engine, also draw the engine's real top moves as thinner
   * arrows next to the weakened pick.
   */
  weakenedShowsTopMoves: boolean;
  /** Search limit: fixed depth, or a movetime cap in ms. */
  searchMode: 'depth' | 'movetime';
  depth: number;
  movetimeMs: number;
  /** Number of arrows, 1-3. */
  arrows: 1 | 2 | 3;
  /** Show hints immediately, or wait for the "show hint" shortcut in bot games. */
  hintMode: 'instant' | 'hotkey';
  /** On demand: the first shortcut press shows only the piece to move, the second the move. */
  hintSteps: boolean;
  /** Print each arrow's score at its target square. */
  arrowScores: boolean;
  /** On the user's turn, show what the bot threatens if the user ignores it. */
  showThreats: boolean;
  /** Alternatives that give up more win chance than this (points, 0-100) are not drawn. */
  hideWorseWinLoss: number;
  /** A threat is shown only when allowing it would cost at least this much win chance. */
  threatWinLoss: number;
  /** One engine instead of three: less memory, but the extra searches wait their turn. */
  lightMode: boolean;
  /** Prefer a move that keeps the game going over one that draws at once, when it costs little. */
  avoidDraws: boolean;
  /** Engine depth for full-game analysis. */
  analysisDepth: number;
  /** Rate the user's moves (Best, Mistake...) during bot games. */
  liveRatings: boolean;
  /** Occasionally choose a playable MultiPV alternative instead of the engine's first choice. */
  occasionalWeakerMoves: boolean;
  /** Chance per eligible user turn to choose a weaker alternative, 0-100%. */
  weakerMoveChancePercent: number;
  /** Maximum evaluation loss allowed for an occasional alternative, in centipawns. */
  weakerMoveMaxLossCp: number;
  /** Automatically submit Vektra's final move choice during bot games. */
  autoPlay: boolean;
  /** Minimum and maximum pause before submitting an automatic move, in seconds. */
  autoPlayMinDelaySec: number;
  autoPlayMaxDelaySec: number;
  /** Use the downloaded full-strength engine instead of the bundled lite one. */
  engine: 'lite' | 'full';
  /** Ask GitHub for the latest Vektra release (on start, and at most hourly from the popup). */
  updateCheck: boolean;
  /** Install a new release through the updater helper as soon as it is found. */
  autoUpdate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  skillLevel: 20,
  limitStrength: false,
  elo: 2000,
  weakenedShowsTopMoves: false,
  searchMode: 'depth',
  depth: 16,
  movetimeMs: 1500,
  arrows: 3,
  hintMode: 'instant',
  hintSteps: true,
  arrowScores: true,
  showThreats: true,
  hideWorseWinLoss: 10,
  threatWinLoss: 12,
  lightMode: false,
  avoidDraws: true,
  analysisDepth: 12,
  liveRatings: true,
  occasionalWeakerMoves: false,
  weakerMoveChancePercent: 50,
  weakerMoveMaxLossCp: 200,
  autoPlay: false,
  autoPlayMinDelaySec: 0.5,
  autoPlayMaxDelaySec: 2,
  engine: 'lite',
  updateCheck: true,
  autoUpdate: true,
};

/**
 * One-click setups offered in the popup. Each sets only the fields it lists.
 */
export const PRESETS: Record<string, { description: string; settings: Partial<Settings> }> = {
  Study: {
    description: 'Full skill, three candidate moves, depth 18',
    settings: { skillLevel: 20, limitStrength: false, arrows: 3, hintMode: 'instant', searchMode: 'depth', depth: 18 },
  },
  Coach: {
    description: 'One suggestion at an approximate 1500 Elo',
    settings: { limitStrength: true, elo: 1500, arrows: 1, hintMode: 'instant' },
  },
  Fast: {
    description: 'One suggestion from a 500 ms search',
    settings: { skillLevel: 20, limitStrength: false, arrows: 1, hintMode: 'instant', searchMode: 'movetime', movetimeMs: 500 },
  },
  'On demand': {
    description: 'Show hints only when you press the show-hint shortcut',
    settings: { hintMode: 'hotkey' },
  },
};

export const ELO_MIN = 1320;
export const ELO_MAX = 3190;
export const ELO_PRESETS = [
  { label: 'Beginner', elo: 1400 },
  { label: 'Club', elo: 1800 },
  { label: 'Strong', elo: 2400 },
  { label: 'Maximum', elo: ELO_MAX },
] as const;
export const DEPTH_MAX = 30;
export const MOVETIME_MIN = 100;
export const MOVETIME_MAX = 10000;
export const WEAKER_MOVE_MULTIPV = 5;
/** Engine lines searched when weaker moves are on, to reach clearly worse moves. */
export const WEAKER_CANDIDATE_MULTIPV = 10;
export const AUTOPLAY_DELAY_MAX_SEC = 30;
export const ANALYSIS_DEPTH_MIN = 8;
export const ANALYSIS_DEPTH_MAX = 24;

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const clampNum = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Fill in missing fields and clamp everything to its valid range. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<keyof Settings | 'autoPlayDelayMs', unknown>
  >;
  const d = DEFAULT_SETTINGS;
  const legacyDelay = [0, 500, 1000, 2000, 3000].includes(Number(r.autoPlayDelayMs))
    ? Number(r.autoPlayDelayMs) / 1000
    : undefined;
  const autoPlayMinDelaySec = clampNum(
    r.autoPlayMinDelaySec,
    0,
    AUTOPLAY_DELAY_MAX_SEC,
    legacyDelay ?? d.autoPlayMinDelaySec,
  );
  const legacyRangeOnly = legacyDelay !== undefined &&
    r.autoPlayMinDelaySec === undefined &&
    r.autoPlayMaxDelaySec === undefined;
  return {
    enabled: bool(r.enabled, d.enabled),
    skillLevel: clampInt(r.skillLevel, 0, 20, d.skillLevel),
    limitStrength: bool(r.limitStrength, d.limitStrength),
    elo: clampInt(r.elo, ELO_MIN, ELO_MAX, d.elo),
    weakenedShowsTopMoves: bool(r.weakenedShowsTopMoves, d.weakenedShowsTopMoves),
    searchMode: oneOf(r.searchMode, ['depth', 'movetime'] as const, d.searchMode),
    depth: clampInt(r.depth, 1, DEPTH_MAX, d.depth),
    movetimeMs: clampInt(r.movetimeMs, MOVETIME_MIN, MOVETIME_MAX, d.movetimeMs),
    arrows: clampInt(r.arrows, 1, 3, d.arrows) as 1 | 2 | 3,
    hintMode: oneOf(r.hintMode, ['instant', 'hotkey'] as const, d.hintMode),
    hintSteps: bool(r.hintSteps, d.hintSteps),
    arrowScores: bool(r.arrowScores, d.arrowScores),
    showThreats: bool(r.showThreats, d.showThreats),
    hideWorseWinLoss: clampInt(r.hideWorseWinLoss, 2, 40, d.hideWorseWinLoss),
    threatWinLoss: clampInt(r.threatWinLoss, 4, 40, d.threatWinLoss),
    lightMode: bool(r.lightMode, d.lightMode),
    avoidDraws: bool(r.avoidDraws, d.avoidDraws),
    liveRatings: bool(r.liveRatings, d.liveRatings),
    occasionalWeakerMoves: bool(r.occasionalWeakerMoves, d.occasionalWeakerMoves),
    weakerMoveChancePercent: clampInt(r.weakerMoveChancePercent, 0, 100, d.weakerMoveChancePercent),
    weakerMoveMaxLossCp: clampInt(r.weakerMoveMaxLossCp, 10, 300, d.weakerMoveMaxLossCp),
    autoPlay: bool(r.autoPlay, d.autoPlay),
    autoPlayMinDelaySec,
    autoPlayMaxDelaySec: clampNum(
      r.autoPlayMaxDelaySec,
      autoPlayMinDelaySec,
      AUTOPLAY_DELAY_MAX_SEC,
      legacyRangeOnly ? legacyDelay : Math.max(autoPlayMinDelaySec, d.autoPlayMaxDelaySec),
    ),
    engine: oneOf(r.engine, ['lite', 'full'] as const, d.engine),
    updateCheck: bool(r.updateCheck, d.updateCheck),
    autoUpdate: bool(r.autoUpdate, d.autoUpdate),
    analysisDepth: clampInt(r.analysisDepth, ANALYSIS_DEPTH_MIN, ANALYSIS_DEPTH_MAX, d.analysisDepth),
  };
}

/** Pick the configured pause before an automatic move, in milliseconds. */
export function autoPlayDelayMs(s: Settings, random: () => number = Math.random): number {
  const sample = random();
  const fraction = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0;
  return (s.autoPlayMinDelaySec + fraction * (s.autoPlayMaxDelaySec - s.autoPlayMinDelaySec)) * 1000;
}
