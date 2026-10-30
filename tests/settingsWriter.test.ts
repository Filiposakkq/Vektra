import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';

type SettingsModule = typeof import('../src/shared/settings');

/** A fresh copy of the settings module: one per extension context. */
async function context(writer = false): Promise<SettingsModule> {
  vi.resetModules();
  const settings = await import('../src/shared/settings');
  if (writer) settings.becomeSettingsWriter();
  return settings;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4)));

/**
 * chrome.storage with random delays that counts writes in progress, and a
 * chrome.runtime.sendMessage that delivers to `writer` like the background.
 */
function stubChrome(initial: Partial<Settings> = DEFAULT_SETTINGS) {
  const sync: Record<string, unknown> = { settings: { ...initial } };
  const local: Record<string, unknown> = {};
  const stats = { writing: 0, maxWriting: 0, writes: 0, migrationReads: 0, sent: [] as string[] };
  const area = (data: Record<string, unknown>) => ({
    get: vi.fn(async (key: string) => {
      if (key === 'settingsMigrations') stats.migrationReads++;
      await pause();
      return { [key]: structuredClone(data[key]) };
    }),
    set: vi.fn(async (values: Record<string, unknown>) => {
      stats.writing++;
      stats.writes++;
      stats.maxWriting = Math.max(stats.maxWriting, stats.writing);
      await pause();
      Object.assign(data, structuredClone(values));
      stats.writing--;
    }),
  });
  let writer: SettingsModule | null = null;
  const runtime = {
    sendMessage: vi.fn(
      (msg: { type: string }) =>
        new Promise((resolve, reject) => {
          stats.sent.push(msg.type);
          if (!writer?.handleSettingsMessage(structuredClone(msg), resolve)) reject(new Error('no receiver'));
        }),
    ),
  };
  vi.stubGlobal('chrome', { storage: { sync: area(sync), local: area(local) }, runtime });
  return { sync, local, stats, runtime, setWriter: (m: SettingsModule) => (writer = m) };
}

afterEach(() => vi.unstubAllGlobals());

describe('settings single writer', () => {
  it('keeps every change when many contexts save at once', async () => {
    const chrome = stubChrome();
    const background = chrome.setWriter(await context(true));
    // Popup, floating settings and three tabs, each changing its own field.
    const fields = ['elo', 'skillLevel', 'depth', 'movetimeMs', 'weakerMoveChancePercent'] as const;
    const values: Record<(typeof fields)[number], number[]> = {
      elo: [1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300],
      skillLevel: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      depth: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      movetimeMs: [200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
      weakerMoveChancePercent: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    };
    const senders = [];
    for (const field of fields) senders.push({ field, settings: await context() });

    const saves: Promise<Settings>[] = [];
    for (let i = 0; i < 10; i++) {
      for (const { field, settings } of senders) {
        const patch = { [field]: values[field][i] } as Partial<Settings>;
        saves.push(
          settings.saveSettings(patch).then((saved) => {
            expect(saved).toMatchObject(patch);
            return saved;
          }),
        );
      }
      // The background's own change (the toggle-hints shortcut) in between.
      if (i % 3 === 0) saves.push(background.applySettingsPatch(({ enabled }) => ({ enabled: !enabled })));
    }
    await Promise.all(saves);

    expect(saves).toHaveLength(54);
    expect(chrome.sync.settings).toMatchObject({
      elo: 2300,
      skillLevel: 10,
      depth: 14,
      movetimeMs: 1100,
      weakerMoveChancePercent: 10,
      enabled: true, // toggled four times
    });
    expect(chrome.stats.maxWriting).toBe(1);
    // One storage write per change, plus the migration flags.
    expect(chrome.stats.writes).toBe(55);
  });

  it('runs the migrations once per context', async () => {
    const chrome = stubChrome({ ...DEFAULT_SETTINGS, analysisDepth: 16 });
    chrome.setWriter(await context(true));
    const popup = await context();
    const tab = await context();

    expect((await popup.loadSettings()).analysisDepth).toBe(12);
    await popup.loadSettings();
    await popup.saveSettings({ elo: 1500 });
    await tab.loadSettings();
    await tab.loadSettings();

    expect(chrome.stats.sent.filter((t) => t === 'vektra:migrate-settings')).toHaveLength(2);
    // The background ran them only once.
    expect(chrome.stats.migrationReads).toBe(1);
    expect(chrome.local.settingsMigrations).toEqual({ weakerMovesV1: true, analysisSpeedV1: true });
  });

  it('rejects a save the background worker did not apply', async () => {
    const chrome = stubChrome();
    const popup = await context();

    chrome.runtime.sendMessage.mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );
    await expect(popup.saveSettings({ elo: 1500 })).rejects.toThrow('Receiving end does not exist');

    chrome.runtime.sendMessage.mockResolvedValueOnce({ ok: false, error: 'QUOTA_BYTES_PER_ITEM quota exceeded' });
    await expect(popup.saveSettings({ elo: 1500 })).rejects.toThrow('quota exceeded');

    chrome.runtime.sendMessage.mockResolvedValueOnce(undefined);
    await expect(popup.saveSettings({ elo: 1500 })).rejects.toThrow('did not reply');

    // Later saves still go through.
    chrome.setWriter(await context(true));
    await expect(popup.saveSettings({ elo: 1600 })).resolves.toMatchObject({ elo: 1600 });
    expect(chrome.sync.settings).toMatchObject({ elo: 1600 });
  });

  it('still reads settings when the migration request fails, and asks again next time', async () => {
    const chrome = stubChrome({ ...DEFAULT_SETTINGS, elo: 1800 });
    const tab = await context();
    chrome.runtime.sendMessage.mockRejectedValueOnce(new Error('worker restarting'));
    expect((await tab.loadSettings()).elo).toBe(1800);
    chrome.setWriter(await context(true));
    await tab.loadSettings();
    const asked = chrome.runtime.sendMessage.mock.calls.filter(([msg]) => msg.type === 'vektra:migrate-settings');
    expect(asked).toHaveLength(2);
  });

  it('answers only settings messages and drops invalid fields from a patch', async () => {
    const chrome = stubChrome();
    const background = await context(true);
    const reply = vi.fn();
    expect(background.handleSettingsMessage({ type: 'vektra:ensure-engine' }, reply)).toBe(false);
    expect(background.handleSettingsMessage(null, reply)).toBe(false);

    expect(
      background.handleSettingsMessage({ type: 'vektra:save-settings', patch: { elo: 99999, bogus: 1 } }, reply),
    ).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(reply.mock.calls[0][0]).toMatchObject({ ok: true, settings: { elo: 3190 } });
    expect(chrome.sync.settings).not.toHaveProperty('bogus');
  });
});
