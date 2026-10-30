import { FULL_ENGINE_STATUS, FULL_ENGINE_STATUS_KEY } from '../engine/fullEngine';
import { ENSURE_ENGINE } from '../engine/protocol';
import { SHOW_HINT, applySettingsPatch, becomeSettingsWriter, handleSettingsMessage } from '../shared/settings';

/**
 * Background service worker. Starts the offscreen document that hosts the
 * Stockfish workers, and handles the keyboard shortcuts.
 */

// All settings changes are written here, one at a time (see settings.ts).
becomeSettingsWriter();

const OFFSCREEN_URL = 'src/engine/offscreen.html';
let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the Stockfish engine in a Web Worker for hints and analysis.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === FULL_ENGINE_STATUS && msg.status) {
    void chrome.storage.local.set({ [FULL_ENGINE_STATUS_KEY]: msg.status });
    return;
  }
  if (handleSettingsMessage(msg, sendResponse)) return true;
  if (msg?.type !== ENSURE_ENGINE) return;
  ensureOffscreen().then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ ok: false, error: String(err) }),
  );
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-hints') {
    await applySettingsPatch(({ enabled }) => ({ enabled: !enabled }));
  } else if (command === 'show-hint') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: SHOW_HINT }).catch(() => {});
  }
});
