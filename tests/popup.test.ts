import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { installFakeChrome, type FakeChrome } from './fixtures/chrome';

const POPUP_HTML = readFileSync(join(import.meta.dirname, '../src/popup/index.html'), 'utf8');

let fake: FakeChrome;
const documentListeners: Parameters<typeof document.addEventListener>[] = [];

/**
 * Load the popup page with the fake chrome API. Settings saves go to a
 * separate copy of the settings module acting as the background worker, the
 * way they do in the extension.
 */
async function openPopup(stored = { ...DEFAULT_SETTINGS }) {
  vi.resetModules();
  const background = await import('../src/shared/settings');
  background.becomeSettingsWriter();
  fake = installFakeChrome({
    sync: { settings: stored },
    onSendMessage: (msg) =>
      new Promise((resolve) => {
        if (!background.handleSettingsMessage(msg, resolve)) resolve(undefined);
      }),
  });
  fake.chrome.tabs.query.mockResolvedValue([{ url: 'https://www.chess.com/play/online' } as chrome.tabs.Tab]);

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
  await import('../src/popup/popup');
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
});
