import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineSettingForStatus } from '@ext/engine/fullEngine';
import { DEFAULT_SETTINGS } from '@core/settings';
import { FakeEvent, installFakeChrome } from '../fixtures/chrome';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('engine setting from the full engine status', () => {
  it('switches to full only when a download finishes, and to lite when the engine goes away', () => {
    expect(engineSettingForStatus('downloading', 'ready')).toBe('full');
    expect(engineSettingForStatus('missing', 'ready')).toBeNull();
    expect(engineSettingForStatus(undefined, 'ready')).toBeNull();
    expect(engineSettingForStatus('ready', 'missing')).toBe('lite');
    expect(engineSettingForStatus('downloading', 'error')).toBe('lite');
    expect(engineSettingForStatus('missing', 'downloading')).toBeNull();
    // The same status reported again (every popup open asks for it) changes nothing.
    expect(engineSettingForStatus('ready', 'ready')).toBeNull();
    expect(engineSettingForStatus('missing', 'missing')).toBeNull();
  });
});

/** The background worker with a fake chrome API; returns a way to send it a status. */
async function background(engine: 'lite' | 'full', status?: string) {
  const fake = installFakeChrome({
    sync: { settings: { ...DEFAULT_SETTINGS, engine } },
    local: {
      settingsMigrations: { weakerMovesV1: true, analysisSpeedV1: true },
      ...(status ? { fullEngineStatus: { state: status } } : {}),
    },
  });
  Object.assign(fake.chrome, {
    offscreen: { hasDocument: async () => true, createDocument: async () => {}, Reason: { WORKERS: 'WORKERS' } },
    commands: { ...fake.chrome.commands, onCommand: new FakeEvent() },
  });
  vi.resetModules();
  await import('@ext/background');
  const report = async (state: string) => {
    fake.runtime.onMessage.emit({ type: 'vektra:full-engine:status', status: { state } } as never, {}, () => {});
    await vi.waitFor(() => expect(fake.local.data.fullEngineStatus).toEqual({ state }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const engineSetting = () => (fake.sync.data.settings as { engine: string }).engine;
  return { fake, report, engineSetting };
}

describe('background full engine status', () => {
  it('selects the full engine once its download finishes', async () => {
    const { report, engineSetting, fake } = await background('lite', 'missing');
    await report('downloading');
    expect(engineSetting()).toBe('lite');
    await report('ready');
    await vi.waitFor(() => expect(engineSetting()).toBe('full'));
    const writes = fake.sync.set.mock.calls.length;
    await report('ready');
    expect(fake.sync.set.mock.calls.length).toBe(writes);
  });

  it('goes back to lite when the full engine is removed', async () => {
    const { report, engineSetting } = await background('full', 'ready');
    await report('missing');
    await vi.waitFor(() => expect(engineSetting()).toBe('lite'));
  });

  it('does not write the engine setting for a status reported again', async () => {
    const { report, fake } = await background('full', 'ready');
    await report('ready');
    expect(fake.sync.set).not.toHaveBeenCalled();
  });
});

describe('toolbar button', () => {
  it('is enabled on chess.com only', async () => {
    const { fake } = await background('lite');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: '0.2.0' })));
    fake.runtime.onInstalled.emit({ reason: 'install' });
    const { action, declarativeContent } = fake.chrome;
    expect(action.disable).toHaveBeenCalledWith();
    expect(declarativeContent.onPageChanged.addRules).toHaveBeenCalledTimes(1);
    const [rule] = declarativeContent.onPageChanged.addRules.mock.calls[0][0] as {
      conditions: { options: unknown }[];
      actions: unknown[];
    }[];
    expect(rule.conditions.map((c) => c.options)).toEqual([{ pageUrl: { hostEquals: 'www.chess.com', schemes: ['https'] } }]);
    expect(rule.actions[0]).toBeInstanceOf(declarativeContent.ShowAction);
    // Installing also checks for an update; let it finish before the fake chrome goes.
    await vi.waitFor(() => expect((fake.local.data.updateState as { checkedAt: number } | undefined)?.checkedAt).toBeGreaterThan(0));
  });
});
