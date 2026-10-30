import { describe, expect, it, vi } from 'vitest';
import {
  autoPlayDelayMs,
  DEFAULT_SETTINGS,
  ELO_PRESETS,
  ELO_MAX,
  ELO_MIN,
  loadSettings,
  PRESETS,
  saveSettings,
  sanitizeSettings,
  type Settings,
} from '../src/shared/settings';

describe('sanitizeSettings', () => {
  it('fills defaults for missing or broken storage', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('junk')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ arrows: 2 })).toEqual({ ...DEFAULT_SETTINGS, arrows: 2 });
    expect(sanitizeSettings({ autoPlay: true }).autoPlay).toBe(true);
  });

  it('ignores removed display preferences from older saved settings', () => {
    const settings = sanitizeSettings({
      showEvalBar: false,
      arrowColors: ['#000000', '#111111', '#222222'],
      arrows: 2,
    });
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, arrows: 2 });
    expect(settings).not.toHaveProperty('showEvalBar');
    expect(settings).not.toHaveProperty('arrowColors');
  });

  it('clamps numbers to their ranges', () => {
    const s = sanitizeSettings({ skillLevel: 25, elo: 900, depth: 0, movetimeMs: 50000, arrows: 7 });
    expect(s).toMatchObject({ skillLevel: 20, elo: 1320, depth: 1, movetimeMs: 10000, arrows: 3 });
    expect(sanitizeSettings({ elo: 'abc' }).elo).toBe(DEFAULT_SETTINGS.elo);
    expect(sanitizeSettings({ skillLevel: 7.6 }).skillLevel).toBe(8);
    expect(sanitizeSettings({ autoPlayMinDelaySec: 40 }).autoPlayMinDelaySec).toBe(30);
    expect(sanitizeSettings({ autoPlayMaxDelaySec: -1 }).autoPlayMaxDelaySec).toBe(0.5);
    expect(sanitizeSettings({ autoPlayDelayMs: 2000 })).toMatchObject({
      autoPlayMinDelaySec: 2,
      autoPlayMaxDelaySec: 2,
    });
    expect(sanitizeSettings({ weakerMoveChancePercent: 90, weakerMoveMaxLossCp: 5 })).toMatchObject({
      weakerMoveChancePercent: 90,
      weakerMoveMaxLossCp: 10,
    });
    expect(sanitizeSettings({ weakerMoveChancePercent: 120 }).weakerMoveChancePercent).toBe(100);
  });

  it('rejects unknown enum values', () => {
    expect(sanitizeSettings({ hintMode: 'always', searchMode: 'nodes' })).toMatchObject({
      hintMode: DEFAULT_SETTINGS.hintMode,
      searchMode: DEFAULT_SETTINGS.searchMode,
    });
  });

  it('removes obsolete hint delay settings and defaults old modes to instant', () => {
    const settings = sanitizeSettings({
      hintMode: 'random',
      delayMinSec: 5,
      delayMaxSec: 2,
      fixedDelaySec: 1,
    });
    expect(settings.hintMode).toBe('instant');
    expect(settings).not.toHaveProperty('delayMinSec');
    expect(settings).not.toHaveProperty('delayMaxSec');
    expect(settings).not.toHaveProperty('fixedDelaySec');
  });

  it('keeps the autoplay maximum delay at or above the minimum', () => {
    expect(sanitizeSettings({ autoPlayMinDelaySec: 5, autoPlayMaxDelaySec: 2 })).toMatchObject({
      autoPlayMinDelaySec: 5,
      autoPlayMaxDelaySec: 5,
    });
  });
});

describe('autoPlayDelayMs', () => {
  const settings = { ...DEFAULT_SETTINGS, autoPlayMinDelaySec: 1, autoPlayMaxDelaySec: 3 };

  it('picks a delay within the configured range', () => {
    expect(autoPlayDelayMs(settings, () => 0)).toBe(1000);
    expect(autoPlayDelayMs(settings, () => 0.5)).toBe(2000);
    expect(autoPlayDelayMs(settings, () => 1)).toBe(3000);
  });

  it('uses the same delay when the range is fixed and clamps random input', () => {
    expect(autoPlayDelayMs({ ...settings, autoPlayMinDelaySec: 2, autoPlayMaxDelaySec: 2 }, () => 0.8)).toBe(2000);
    expect(autoPlayDelayMs(settings, () => -1)).toBe(1000);
    expect(autoPlayDelayMs(settings, () => 2)).toBe(3000);
    expect(autoPlayDelayMs(settings, () => Number.NaN)).toBe(1000);
  });
});

describe('settings migration', () => {
  it('serializes concurrent updates so each patch preserves the others', async () => {
    const syncData: Record<string, unknown> = {
      settings: { ...DEFAULT_SETTINGS },
    };
    const localData: Record<string, unknown> = {
      settingsMigrations: { weakerMovesV1: true, analysisSpeedV1: true },
    };
    const sync = {
      get: vi.fn(async (key: string) => ({ [key]: syncData[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => {
        const next = values.settings as Settings;
        if (next.elo === 2400) await new Promise((resolve) => setTimeout(resolve, 20));
        Object.assign(syncData, values);
      }),
    };
    const local = {
      get: vi.fn(async (key: string) => ({ [key]: localData[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => Object.assign(localData, values)),
    };
    vi.stubGlobal('chrome', { storage: { sync, local } });

    try {
      await Promise.all([saveSettings({ elo: 2400 }), saveSettings({ skillLevel: 9 })]);
      expect(syncData.settings).toMatchObject({ elo: 2400, skillLevel: 9 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('updates the previous weaker-move defaults once without replacing custom values', async () => {
    const syncData: Record<string, unknown> = {
      settings: {
        ...DEFAULT_SETTINGS,
        analysisDepth: 16,
        weakerMoveChancePercent: 20,
        weakerMoveMaxLossCp: 100,
      },
    };
    const localData: Record<string, unknown> = {};
    const storageArea = (data: Record<string, unknown>) => ({
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => Object.assign(data, values)),
    });
    const sync = storageArea(syncData);
    const local = storageArea(localData);
    vi.stubGlobal('chrome', { storage: { sync, local } });

    try {
      const settings = await loadSettings();
      expect(settings).toMatchObject({
        analysisDepth: 12,
        weakerMoveChancePercent: 50,
        weakerMoveMaxLossCp: 200,
      });
      expect(sync.set).toHaveBeenCalledTimes(1);
      expect(local.set).toHaveBeenCalledTimes(1);
      await loadSettings();
      expect(sync.set).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves customized weaker-move values during the one-time migration', async () => {
    const syncData: Record<string, unknown> = {
      settings: {
        ...DEFAULT_SETTINGS,
        analysisDepth: 20,
        weakerMoveChancePercent: 20,
        weakerMoveMaxLossCp: 150,
      },
    };
    const localData: Record<string, unknown> = {};
    const storageArea = (data: Record<string, unknown>) => ({
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => Object.assign(data, values)),
    });
    const sync = storageArea(syncData);
    vi.stubGlobal('chrome', { storage: { sync, local: storageArea(localData) } });

    try {
      expect((await loadSettings()).weakerMoveChancePercent).toBe(20);
      expect((await loadSettings()).analysisDepth).toBe(20);
      expect(sync.set).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('updates analysis depth for installs that already completed the weaker-move migration', async () => {
    const syncData: Record<string, unknown> = {
      settings: { ...DEFAULT_SETTINGS, analysisDepth: 16 },
    };
    const localData: Record<string, unknown> = {
      settingsMigrations: { weakerMovesV1: true },
    };
    const storageArea = (data: Record<string, unknown>) => ({
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => Object.assign(data, values)),
    });
    const sync = storageArea(syncData);
    const local = storageArea(localData);
    vi.stubGlobal('chrome', { storage: { sync, local } });

    try {
      expect((await loadSettings()).analysisDepth).toBe(12);
      expect(sync.set).toHaveBeenCalledOnce();
      expect(localData.settingsMigrations).toEqual({
        weakerMovesV1: true,
        analysisSpeedV1: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Elo presets', () => {
  it('offer increasing approximate targets within Stockfish limits', () => {
    const targets = ELO_PRESETS.map(({ elo }) => elo);
    expect(targets[0]).toBeGreaterThanOrEqual(ELO_MIN);
    expect(targets[targets.length - 1]).toBe(ELO_MAX);
    expect(targets).toEqual([...targets].sort((a, b) => a - b));
  });
});

describe('quick setups', () => {
  it('offers distinct study, coach, fast, and on-demand profiles', () => {
    expect(Object.keys(PRESETS)).toEqual(['Study', 'Coach', 'Fast', 'On demand']);
    expect(PRESETS.Study.settings).toMatchObject({ arrows: 3, searchMode: 'depth', depth: 18 });
    expect(PRESETS.Coach.settings).toMatchObject({ limitStrength: true, elo: 1500, arrows: 1 });
    expect(PRESETS.Fast.settings).toMatchObject({ searchMode: 'movetime', movetimeMs: 500, arrows: 1 });
    expect(PRESETS['On demand'].settings).toMatchObject({ hintMode: 'hotkey' });
  });
});
