import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';
import { compareVersions, parseRelease, type UpdateState } from '../src/shared/updates';
import { installFakeChrome } from './fixtures/chrome';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('versions and releases', () => {
  it('compares dotted versions by number', () => {
    expect(compareVersions('0.10.0', '0.9.2')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('0.2', '0.2.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('reads the version and page of a GitHub release', () => {
    expect(parseRelease({ tag_name: 'v0.3.0', html_url: 'https://github.com/x/releases/tag/v0.3.0' })).toEqual({
      version: '0.3.0',
      url: 'https://github.com/x/releases/tag/v0.3.0',
    });
    expect(parseRelease({ tag_name: '0.3.1' })?.version).toBe('0.3.1');
    expect(parseRelease({ tag_name: 'nightly' })).toBeNull();
    expect(parseRelease({ message: 'Not Found' })).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });
});

interface Setup {
  running?: string;
  /** The version in Vektra's folder before any update. */
  folder?: string;
  /** Latest release tag on GitHub, or null for none published (404). */
  release?: string | null;
  helper?: boolean;
  /** The helper's reply to an update; by default it installs the release. */
  updateReply?: { ok: boolean; error?: string };
  gameInProgress?: boolean;
  settings?: Partial<Settings>;
  state?: Partial<UpdateState>;
}

/** The background update code with a fake chrome API, fetch and updater helper. */
async function updates({
  running = '0.2.0',
  folder = running,
  release = 'v0.3.0',
  helper = false,
  updateReply,
  gameInProgress = false,
  settings = {},
  state,
}: Setup = {}) {
  const fake = installFakeChrome({
    sync: { settings: { ...DEFAULT_SETTINGS, ...settings } },
    local: {
      settingsMigrations: { weakerMovesV1: true, analysisSpeedV1: true },
      ...(state ? { updateState: state } : {}),
    },
  });
  fake.runtime.getManifest.mockReturnValue({ version: running } as chrome.runtime.Manifest);
  let onDisk = folder;
  fake.runtime.sendNativeMessage.mockImplementation(async (_host, msg) => {
    if (!helper) throw new Error('Specified native messaging host not found.');
    if ((msg as { type: string }).type === 'ping') return { ok: true, version: onDisk };
    const reply = updateReply ?? { ok: true };
    if (reply.ok && release) onDisk = release.replace(/^v/, '');
    return reply;
  });
  fake.chrome.tabs.query.mockResolvedValue([{ id: 3 } as chrome.tabs.Tab]);
  fake.chrome.tabs.sendMessage.mockImplementation((async () => gameInProgress) as unknown as () => Promise<undefined>);
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('manifest.json')) return Response.json({ version: onDisk });
    if (release === null) return Response.json({ message: 'Not Found' }, { status: 404 });
    return Response.json({ tag_name: release, html_url: `https://github.com/releases/tag/${release}` });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  (await import('../src/shared/settings')).becomeSettingsWriter();
  const mod = await import('../src/background/updates');
  const githubCalls = () => fetchMock.mock.calls.filter(([url]) => url.includes('api.github.com')).length;
  const updateRequests = () =>
    fake.runtime.sendNativeMessage.mock.calls.filter(([, msg]) => (msg as { type: string }).type === 'update').length;
  return { fake, mod, githubCalls, updateRequests };
}

describe('background updates', () => {
  it('finds a new release but leaves it to the popup without the helper', async () => {
    const { mod, fake, updateRequests } = await updates();
    const state = await mod.checkForUpdate();
    expect(state.latest?.version).toBe('0.3.0');
    expect(state.helper).toBe(false);
    expect(state.phase).toBe('idle');
    expect(updateRequests()).toBe(0);
    expect(fake.runtime.reload).not.toHaveBeenCalled();
  });

  it('installs a new release through the helper and reloads', async () => {
    const { mod, fake, updateRequests } = await updates({ helper: true });
    const state = await mod.checkForUpdate();
    expect(updateRequests()).toBe(1);
    expect(state).toMatchObject({ phase: 'waiting', installed: '0.3.0' });
    await vi.waitFor(() => expect(fake.runtime.reload).toHaveBeenCalled());
  });

  it('waits for the bot game to end before reloading', async () => {
    const { mod, fake } = await updates({ helper: true, gameInProgress: true });
    await mod.checkForUpdate();
    await vi.waitFor(() => expect(fake.chrome.alarms.create).toHaveBeenCalledWith(mod.RELOAD_ALARM, { delayInMinutes: 1 }));
    expect(fake.runtime.reload).not.toHaveBeenCalled();
  });

  it('only offers the update when "Update automatically" is off', async () => {
    const { mod, updateRequests } = await updates({ helper: true, settings: { autoUpdate: false } });
    const state = await mod.checkForUpdate();
    expect(state).toMatchObject({ phase: 'idle', helper: true, latest: { version: '0.3.0' } });
    expect(updateRequests()).toBe(0);
    expect((await mod.installUpdate()).phase).toBe('waiting');
    expect(updateRequests()).toBe(1);
  });

  it('asks GitHub at most hourly from the popup', async () => {
    const { mod, githubCalls } = await updates();
    await mod.checkForUpdate();
    await mod.checkForUpdate();
    expect(githubCalls()).toBe(1);
    await mod.checkForUpdate({ force: true });
    expect(githubCalls()).toBe(2);
  });

  it('asks nothing when the update check is off', async () => {
    const { mod, fake, githubCalls } = await updates({ helper: true, settings: { updateCheck: false } });
    const state = await mod.checkForUpdate();
    expect(githubCalls()).toBe(0);
    expect(fake.runtime.sendNativeMessage).not.toHaveBeenCalled();
    expect(state.latest).toBeNull();
  });

  it('is up to date when no release is published yet', async () => {
    const { mod } = await updates({ release: null });
    const state = await mod.checkForUpdate();
    expect(state.latest).toBeNull();
    expect(state.checkedAt).toBeGreaterThan(0);
  });

  it('reports a failed install and does not retry it on its own', async () => {
    const { mod, fake, updateRequests } = await updates({
      helper: true,
      updateReply: { ok: false, error: 'The download is damaged (checksum mismatch).' },
    });
    const state = await mod.checkForUpdate();
    expect(state).toMatchObject({ phase: 'error', failedVersion: '0.3.0', error: 'The download is damaged (checksum mismatch).' });
    await mod.checkForUpdate({ force: true });
    expect(updateRequests()).toBe(1);
    expect(fake.runtime.reload).not.toHaveBeenCalled();
  });

  it('reloads into a version unzipped over the folder by hand', async () => {
    const { mod, fake, githubCalls } = await updates({ folder: '0.3.0' });
    const state = await mod.checkForUpdate();
    expect(state).toMatchObject({ phase: 'waiting', installed: '0.3.0' });
    expect(githubCalls()).toBe(0);
    await vi.waitFor(() => expect(fake.runtime.reload).toHaveBeenCalled());
  });

  it('clears the waiting state once the new version runs', async () => {
    const { mod } = await updates({
      running: '0.3.0',
      release: 'v0.3.0',
      state: { phase: 'waiting', installed: '0.3.0', checkedAt: Date.now(), latest: { version: '0.3.0', url: '' } },
    });
    expect((await mod.checkForUpdate()).phase).toBe('idle');
  });

  it('leaves a note for the popup when Vektra starts as a new version', async () => {
    const { mod, fake, githubCalls } = await updates({ running: '0.2.3', release: 'v0.2.3' });
    mod.startUpdates();
    fake.runtime.onInstalled.emit({ reason: 'update', previousVersion: '0.2.3' });
    await vi.waitFor(() => expect(githubCalls()).toBe(1));
    // A reload of the same version is no news.
    expect(fake.local.data.updatedNote).toBeUndefined();
    fake.runtime.onInstalled.emit({ reason: 'update', previousVersion: '0.2.2' });
    await vi.waitFor(() => expect(fake.local.data.updatedNote).toEqual({ from: '0.2.2', to: '0.2.3' }));
    await vi.waitFor(() => expect(githubCalls()).toBe(2));
  });

  it('checks when Chrome starts and reloads from the alarm once the game is over', async () => {
    const { mod, fake, githubCalls } = await updates({ state: { checkedAt: Date.now() } });
    mod.startUpdates();
    // Even right after a check: starting and reloading are rare.
    fake.runtime.onStartup.emit();
    await vi.waitFor(() => expect(githubCalls()).toBe(1));
    fake.runtime.onInstalled.emit({ reason: 'update' });
    await vi.waitFor(() => expect(githubCalls()).toBe(2));
    fake.chrome.alarms.onAlarm.emit({ name: mod.RELOAD_ALARM });
    await vi.waitFor(() => expect(fake.runtime.reload).toHaveBeenCalled());
  });
});
