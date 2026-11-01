import {
  FULL_ENGINE_STATUS,
  FULL_ENGINE_STATUS_KEY,
  engineSettingForStatus,
  type FullEngineStatus,
} from '../engine/fullEngine';
import { ENSURE_ENGINE } from '../engine/protocol';
import { SHOW_HINT, applySettingsPatch, becomeSettingsWriter, handleSettingsMessage } from '../shared/settings';
import { UPDATE_CHECK, UPDATE_INSTALL } from '../shared/updates';
import { checkForUpdate, installUpdate, startUpdates } from './updates';

/**
 * Background service worker. Starts the offscreen document that hosts the
 * Stockfish workers, handles the keyboard shortcuts, and checks for updates.
 */

// All settings changes are written here, one at a time (see settings.ts).
becomeSettingsWriter();
startUpdates();

/**
 * The toolbar button opens the settings on chess.com only; elsewhere it is
 * greyed out and does nothing. Chrome keeps the rule between restarts, so it
 * is set again only when Vektra is installed, updated or reloaded.
 */
function limitActionToChesscom(): void {
  void chrome.action.disable();
  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([
      {
        conditions: [
          new chrome.declarativeContent.PageStateMatcher({ pageUrl: { hostEquals: 'www.chess.com', schemes: ['https'] } }),
        ],
        actions: [new chrome.declarativeContent.ShowAction()],
      },
    ]);
  });
}
chrome.runtime.onInstalled.addListener(limitActionToChesscom);

const OFFSCREEN_URL = 'src/engine/offscreen.html';
let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  // While it is being created the document already "exists" but may not be
  // listening yet, so a caller that arrives then waits for the creation.
  if (creating) return creating;
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

let statusQueue: Promise<void> = Promise.resolve();

/**
 * Store the full engine's status (offscreen documents can't) and, on a real
 * change, update the engine setting through the settings queue: the only
 * place that writes it.
 */
function recordEngineStatus(status: FullEngineStatus): Promise<void> {
  statusQueue = statusQueue
    .then(async () => {
      const previous = ((await chrome.storage.local.get(FULL_ENGINE_STATUS_KEY))[FULL_ENGINE_STATUS_KEY] as
        | FullEngineStatus
        | undefined)?.state;
      await chrome.storage.local.set({ [FULL_ENGINE_STATUS_KEY]: status });
      const engine = engineSettingForStatus(previous, status.state);
      if (engine === 'full') await applySettingsPatch({ engine: 'full' });
      else if (engine === 'lite') await applySettingsPatch((s) => (s.engine === 'full' ? { engine: 'lite' } : {}));
    })
    .catch((error: unknown) => console.error('[Vektra] Could not record the full engine status:', error));
  return statusQueue;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === FULL_ENGINE_STATUS && msg.status) {
    void recordEngineStatus(msg.status);
    return;
  }
  if (handleSettingsMessage(msg, sendResponse)) return true;
  if (msg?.type === UPDATE_CHECK || msg?.type === UPDATE_INSTALL) {
    (msg.type === UPDATE_CHECK ? checkForUpdate({ force: msg.force === true }) : installUpdate()).then(sendResponse, (error: unknown) => {
      console.error('[Vektra] Update check failed:', error);
      sendResponse(undefined);
    });
    return true;
  }
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
  } else if (command === 'toggle-autoplay') {
    await applySettingsPatch(({ autoPlay }) => ({ autoPlay: !autoPlay }));
  } else if (command === 'show-hint') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: SHOW_HINT }).catch(() => {});
  }
});
