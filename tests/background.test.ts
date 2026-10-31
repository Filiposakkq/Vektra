import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineSettingForStatus } from '../src/engine/fullEngine';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { FakeEvent, installFakeChrome } from './fixtures/chrome';

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
  await import('../src/background/index');
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
