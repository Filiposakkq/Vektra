import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@core/settings';
import type { UpdateState } from '@ext/shared/updates';
import { installFakeChrome, type FakeChrome } from '../fixtures/chrome';

const POPUP_HTML = readFileSync(join(import.meta.dirname, '../../extension/src/popup/index.html'), 'utf8');

let fake: FakeChrome;
const documentListeners: Parameters<typeof document.addEventListener>[] = [];

/**
 * Load the popup page with the fake chrome API. Settings saves go to a
 * separate copy of the settings module acting as the background worker, the
 * way they do in the extension.
 */
async function openPopup(
  stored = { ...DEFAULT_SETTINGS },
  {
    tab = { url: 'https://www.chess.com/play/online' },
    pageHealth,
    updateState,
    updatedNote,
  }: { tab?: Partial<chrome.tabs.Tab>; pageHealth?: unknown; updateState?: UpdateState; updatedNote?: unknown } = {},
) {
  vi.resetModules();
  const background = await import('@ext/shared/settings');
  background.becomeSettingsWriter();
  fake = installFakeChrome({
    sync: { settings: stored },
    local: updatedNote ? { updatedNote } : {},
    onSendMessage: (msg) =>
      new Promise((resolve) => {
        // The background worker's update check answers with the update state.
        if ((msg as { type?: string }).type === 'vektra:update-check') resolve(updateState);
        else if (!background.handleSettingsMessage(msg, resolve)) resolve(undefined);
      }),
  });
  fake.chrome.tabs.query.mockResolvedValue([tab as chrome.tabs.Tab]);
  fake.chrome.tabs.sendMessage.mockImplementation((async () => {
    if (pageHealth instanceof Error) throw pageHealth;
    return pageHealth;
  }) as () => Promise<undefined>);

  const page = new DOMParser().parseFromString(POPUP_HTML, 'text/html');
  page.querySelectorAll('script').forEach((s) => s.remove());
  document.head.replaceChildren(...page.head.children);
  document.body.replaceChildren(...page.body.children);

  // The popup listens on document; remember the listeners so the next test's
  // popup is the only one listening.
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    documentListeners.push([type, listener, options]);
    add(type, listener, options);
  });
  vi.resetModules();
  await import('@ext/popup/popup');
  // Rendered from the stored settings once they have loaded.
  await vi.waitFor(() => expect(input('analysisDepth').value).toBe(String(stored.analysisDepth)));
  await vi.waitFor(() => expect(input('hintMode', stored.hintMode).checked).toBe(true));
}

const input = (name: string, value?: string) =>
  document.querySelector<HTMLInputElement>(`input[name="${name}"]${value ? `[value="${value}"]` : ''}`)!;

const savedPatches = () =>
  fake.runtime.sendMessage.mock.calls
    .map(([msg]) => msg as { type: string; patch?: unknown })
    .filter((msg) => msg.type === 'vektra:save-settings')
    .map((msg) => msg.patch);

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Not available; the popup copes.
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [type, listener, options] of documentListeners.splice(0)) {
    document.removeEventListener(type, listener, options);
  }
  vi.unstubAllGlobals();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('settings popup', () => {
  it('warns when Vektra cannot read the chess.com page', async () => {
    const tab = { id: 7, url: 'https://www.chess.com/play/computer' };
    await openPopup(undefined, { tab, pageHealth: { problems: ['board'] } });
    const warning = document.getElementById('page-warning')!;
    await vi.waitFor(() => expect(warning.hidden).toBe(false));
    expect(warning.textContent).toMatch(/can't find the board/);
    expect(fake.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'vektra:page-health' });
  });

  it('asks for a reload when Vektra is not running in the tab', async () => {
    const tab = { id: 7, url: 'https://www.chess.com/play/computer' };
    await openPopup(undefined, { tab, pageHealth: new Error('Receiving end does not exist.') });
    const warning = document.getElementById('page-warning')!;
    await vi.waitFor(() => expect(warning.textContent).toMatch(/Reload the page/));
  });

  it('shows no warning when the page reads fine', async () => {
    await openPopup(undefined, { tab: { id: 7, url: 'https://www.chess.com/play/computer' }, pageHealth: { problems: [] } });
    await vi.waitFor(() => expect(fake.chrome.tabs.sendMessage).toHaveBeenCalled());
    expect(document.getElementById('page-warning')!.hidden).toBe(true);
  });

  it('does not check pages other than chess.com', async () => {
    await openPopup(undefined, { tab: { id: 8, url: 'https://example.com/' } });
    expect(fake.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(document.getElementById('page-warning')!.hidden).toBe(true);
  });

  it('shows the stored settings', async () => {
    await openPopup({ ...DEFAULT_SETTINGS, liveRatings: false, hintMode: 'hotkey', analysisDepth: 18 });
    expect(input('liveRatings').checked).toBe(false);
    expect(input('hintMode', 'hotkey').checked).toBe(true);
    expect(input('analysisDepth').value).toBe('18');
    expect(document.querySelector('output[data-for="analysisDepth"]')?.textContent).toBe('18');
  });

  it('saves a toggled checkbox through the background worker', async () => {
    await openPopup();
    input('liveRatings').checked = false;
    input('liveRatings').dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => expect(fake.sync.data.settings).toMatchObject({ liveRatings: false }));
    expect(savedPatches()).toEqual([{ liveRatings: false }]);
  });

  it('saves a radio choice and a slider value as the right types', async () => {
    await openPopup();
    const hotkey = input('hintMode', 'hotkey');
    hotkey.checked = true;
    hotkey.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(savedPatches()).toEqual([{ hintMode: 'hotkey' }]));

    // Slider input is saved when it is released (change), not on every step.
    const depth = input('analysisDepth');
    depth.value = '16';
    depth.dispatchEvent(new Event('input', { bubbles: true }));
    expect(savedPatches()).toHaveLength(1);
    depth.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(savedPatches()).toEqual([{ hintMode: 'hotkey' }, { analysisDepth: 16 }]));
    expect(fake.sync.data.settings).toMatchObject({ hintMode: 'hotkey', analysisDepth: 16 });
  });

  it('keeps a change that is still saving when an older storage change arrives', async () => {
    await openPopup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const send = fake.runtime.sendMessage.getMockImplementation()!;
    fake.runtime.sendMessage.mockImplementationOnce(async (msg) => {
      await held;
      return send(msg);
    });
    input('liveRatings').checked = false;
    input('liveRatings').dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(savedPatches()).toEqual([{ liveRatings: false }]));

    // Another context's earlier save lands while ours is still on its way.
    fake.onChanged.emit({ settings: { newValue: { ...DEFAULT_SETTINGS, analysisDepth: 14 } } }, 'sync');
    expect(input('liveRatings').checked).toBe(false);
    expect(input('analysisDepth').value).toBe('14');

    release();
    await vi.waitFor(() => expect(fake.sync.data.settings).toMatchObject({ liveRatings: false }));
    // Once confirmed, storage is followed again.
    fake.onChanged.emit({ settings: { newValue: { ...DEFAULT_SETTINGS, liveRatings: true } } }, 'sync');
    expect(input('liveRatings').checked).toBe(true);
  });

  it('shows an error when a save fails', async () => {
    await openPopup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.runtime.sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    input('liveRatings').checked = false;
    input('liveRatings').dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(document.getElementById('status')?.textContent).toBe('Settings could not be saved'));
  });

  describe('updates', () => {
    const idle: UpdateState = { checkedAt: Date.now(), latest: null, helper: false, phase: 'idle' };
    const release = { version: '0.3.0', url: 'https://github.com/Filiposakkq/Vektra/releases/tag/v0.3.0' };
    const banner = () => document.getElementById('update-banner')!;
    const shown = (id: string) => !document.getElementById(id)!.hidden;

    it('says Vektra is up to date', async () => {
      await openPopup(undefined, { updateState: idle });
      await vi.waitFor(() => expect(document.getElementById('update-version')!.textContent).toBe('Vektra 0.2.0, up to date'));
      expect(banner().hidden).toBe(true);
      expect(shown('helper-note')).toBe(true);
    });

    it('offers a download without the updater helper', async () => {
      await openPopup(undefined, { updateState: { ...idle, latest: release } });
      await vi.waitFor(() => expect(banner().hidden).toBe(false));
      expect(document.getElementById('update-text')!.textContent).toMatch(/0\.3\.0 is available\. Download it/);
      expect(shown('update-download')).toBe(true);
      expect(shown('update-now')).toBe(false);
      expect((document.getElementById('update-download') as HTMLAnchorElement).href).toBe(release.url);
    });

    it('installs through the helper on "Update now"', async () => {
      await openPopup(undefined, { updateState: { ...idle, latest: release, helper: true } });
      await vi.waitFor(() => expect(shown('update-now')).toBe(true));
      expect(shown('update-download')).toBe(false);
      expect(shown('helper-note')).toBe(false);
      document.getElementById('update-now')!.click();
      await vi.waitFor(() =>
        expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ type: 'vektra:update-install' }),
      );
    });

    it('shows a failed update with a download link', async () => {
      const failed: UpdateState = { ...idle, latest: release, helper: true, phase: 'error', error: 'No network.', failedVersion: '0.3.0' };
      await openPopup(undefined, { updateState: failed });
      await vi.waitFor(() => expect(document.getElementById('update-text')!.textContent).toBe('Updating to Vektra 0.3.0 failed: No network.'));
      expect(shown('update-now')).toBe(true);
      expect(shown('update-download')).toBe(true);
    });

    it('offers to reload when a new version is installed', async () => {
      await openPopup(undefined, { updateState: { ...idle, latest: release, phase: 'waiting', installed: '0.3.0' } });
      await vi.waitFor(() => expect(shown('update-reload')).toBe(true));
      document.getElementById('update-reload')!.click();
      expect(fake.runtime.reload).toHaveBeenCalled();
    });

    it('checks at once when "Check for updates" is ticked again', async () => {
      await openPopup({ ...DEFAULT_SETTINGS, updateCheck: false }, { updateState: idle });
      input('updateCheck').click();
      await vi.waitFor(() =>
        expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ type: 'vektra:update-check', force: true }),
      );
    });

    it('says once that Vektra was updated', async () => {
      await openPopup(undefined, { updateState: idle, updatedNote: { from: '0.2.1', to: '0.2.0' } });
      const note = document.getElementById('update-note')!;
      await vi.waitFor(() => expect(note.hidden).toBe(false));
      expect(note.textContent?.replace(/\s+/g, ' ').trim()).toBe("Updated to Vektra 0.2.0 · What's new");
      expect((document.getElementById('update-note-link') as HTMLAnchorElement).href).toBe(
        'https://github.com/Filiposakkq/Vektra/releases/tag/v0.2.0',
      );
      expect(fake.local.data.updatedNote).toBeUndefined();
    });

    it('drops a note from an earlier update without showing it', async () => {
      await openPopup(undefined, { updateState: idle, updatedNote: { from: '0.1.0', to: '0.1.5' } });
      await vi.waitFor(() => expect(fake.local.data.updatedNote).toBeUndefined());
      expect(document.getElementById('update-note')!.hidden).toBe(true);
    });

    it('shows no new version when the update check is off', async () => {
      await openPopup({ ...DEFAULT_SETTINGS, updateCheck: false }, { updateState: { ...idle, latest: release } });
      await vi.waitFor(() => expect(document.getElementById('update-version')!.textContent).toBe('Vektra 0.2.0'));
      expect(banner().hidden).toBe(true);
      expect(input('autoUpdate').closest('label')!.hidden).toBe(true);
    });
  });
});
