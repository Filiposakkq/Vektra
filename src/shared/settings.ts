/**
 * User settings, stored in chrome.storage.sync and edited in the popup.
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
  /** Show hints immediately, or wait for the "show hint" shortcut in live games. */
  hintMode: 'instant' | 'hotkey';
  /** Engine depth for full-game analysis. */
  analysisDepth: number;
  /** Rate the user's moves (Best, Mistake...) during live games. */
  liveRatings: boolean;
  /** Occasionally choose a playable MultiPV alternative instead of the engine's first choice. */
  occasionalWeakerMoves: boolean;
  /** Chance per eligible user turn to choose a weaker alternative, 0-100%. */
  weakerMoveChancePercent: number;
  /** Maximum evaluation loss allowed for an occasional alternative, in centipawns. */
  weakerMoveMaxLossCp: number;
  /** Automatically submit Vektra's final move choice during live games. */
  autoPlay: boolean;
  /** Minimum and maximum pause before submitting an automatic move, in seconds. */
  autoPlayMinDelaySec: number;
  autoPlayMaxDelaySec: number;
  /** Use the downloaded full-strength engine instead of the bundled lite one. */
  engine: 'lite' | 'full';
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
  analysisDepth: 12,
  liveRatings: true,
  occasionalWeakerMoves: false,
  weakerMoveChancePercent: 50,
  weakerMoveMaxLossCp: 200,
  autoPlay: false,
  autoPlayMinDelaySec: 0.5,
  autoPlayMaxDelaySec: 2,
  engine: 'lite',
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
export const AUTOPLAY_DELAY_MAX_SEC = 30;
export const ANALYSIS_DEPTH_MIN = 8;
export const ANALYSIS_DEPTH_MAX = 24;

const STORAGE_KEY = 'settings';
const MIGRATIONS_KEY = 'settingsMigrations';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function migrateWeakerMoveDefaults(): Promise<void> {
  const [stored, local] = await Promise.all([
    chrome.storage.sync.get(STORAGE_KEY),
    chrome.storage.local.get(MIGRATIONS_KEY),
  ]);
  const migrations = (local[MIGRATIONS_KEY] as Record<string, boolean> | undefined) ?? {};
  const saved = stored[STORAGE_KEY];
  const updated = isRecord(saved) ? { ...saved } : null;
  const nextMigrations = { ...migrations };

  if (!migrations.weakerMovesV1) {
    if (
      updated &&
      'weakerMoveChancePercent' in updated &&
      'weakerMoveMaxLossCp' in updated &&
      updated.weakerMoveChancePercent === 20 &&
      updated.weakerMoveMaxLossCp === 100
    ) {
      updated.weakerMoveChancePercent = DEFAULT_SETTINGS.weakerMoveChancePercent;
      updated.weakerMoveMaxLossCp = DEFAULT_SETTINGS.weakerMoveMaxLossCp;
    }
    nextMigrations.weakerMovesV1 = true;
  }

  if (!migrations.analysisSpeedV1) {
    if (updated?.analysisDepth === 16) updated.analysisDepth = DEFAULT_SETTINGS.analysisDepth;
    nextMigrations.analysisSpeedV1 = true;
  }

  if (updated && JSON.stringify(updated) !== JSON.stringify(saved)) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: updated });
  }
  if (JSON.stringify(nextMigrations) !== JSON.stringify(migrations)) {
    await chrome.storage.local.set({ [MIGRATIONS_KEY]: nextMigrations });
  }
}

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
    analysisDepth: clampInt(r.analysisDepth, ANALYSIS_DEPTH_MIN, ANALYSIS_DEPTH_MAX, d.analysisDepth),
  };
}

/** Pick the configured pause before an automatic move, in milliseconds. */
export function autoPlayDelayMs(s: Settings, random: () => number = Math.random): number {
  const sample = random();
  const fraction = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0;
  return (s.autoPlayMinDelaySec + fraction * (s.autoPlayMaxDelaySec - s.autoPlayMinDelaySec)) * 1000;
}

export async function loadSettings(): Promise<Settings> {
  await migrateWeakerMoveDefaults();
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return sanitizeSettings(stored[STORAGE_KEY]);
}

let settingsWriteQueue: Promise<void> = Promise.resolve();

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const write = settingsWriteQueue.then(async () => {
    const next = sanitizeSettings({ ...(await loadSettings()), ...patch });
    await chrome.storage.sync.set({ [STORAGE_KEY]: next });
    return next;
  });
  settingsWriteQueue = write.then(() => undefined, () => undefined);
  return write;
}

/** Calls back with the new settings whenever they change anywhere. */
export function onSettingsChanged(callback: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync' && STORAGE_KEY in changes) callback(sanitizeSettings(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Messages from the background worker to content scripts for keyboard shortcuts. */
export const SHOW_HINT = 'vektra:show-hint';
export const OPEN_SETTINGS = 'vektra:open-settings';
