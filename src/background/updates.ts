import { loadSettings } from '../shared/settings';
import {
  EMPTY_UPDATE_STATE,
  GAME_IN_PROGRESS,
  LATEST_RELEASE_API,
  UPDATED_NOTE_KEY,
  UPDATER_HOST,
  UPDATE_STATE_KEY,
  compareVersions,
  parseRelease,
  updateAvailable,
  type UpdateState,
} from '../shared/updates';

/**
 * The background side of updates (see shared/updates.ts): ask GitHub for the
 * latest release, have the updater helper install it, and reload Vektra once
 * no bot game is in progress.
 */

/** Opening the popup asks GitHub at most this often. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const RELOAD_ALARM = 'vektra-update-reload';

let queue: Promise<unknown> = Promise.resolve();

/** Run `task` after every earlier update task, so they never overlap. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function readState(): Promise<UpdateState> {
  const stored = (await chrome.storage.local.get(UPDATE_STATE_KEY))[UPDATE_STATE_KEY] as Partial<UpdateState> | undefined;
  return { ...EMPTY_UPDATE_STATE, ...stored };
}

async function writeState(patch: Partial<UpdateState>): Promise<UpdateState> {
  const next = { ...(await readState()), ...patch };
  await chrome.storage.local.set({ [UPDATE_STATE_KEY]: next });
  return next;
}

const runningVersion = () => chrome.runtime.getManifest().version;

/** Whether the updater helper is installed and answers. */
async function helperAnswers(): Promise<boolean> {
  try {
    const reply = (await chrome.runtime.sendNativeMessage(UPDATER_HOST, { type: 'ping' })) as { ok?: boolean } | undefined;
    return reply?.ok === true;
  } catch {
    // "Specified native messaging host not found": the helper isn't installed.
    return false;
  }
}

/**
 * The version in Vektra's folder. It is newer than the running one once an
 * update was copied there, by the helper or by hand, until Vektra reloads.
 */
async function folderVersion(): Promise<string | null> {
  try {
    const manifest = (await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json()) as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

/** True when a chess.com tab is in a bot game that hasn't ended. */
async function gameInProgress(): Promise<boolean> {
  const tabs = await chrome.tabs.query({ url: 'https://www.chess.com/*' });
  const answers = await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? false
        : chrome.tabs.sendMessage(tab.id, { type: GAME_IN_PROGRESS }).then(
            (busy) => busy === true,
            // No answer: the tab runs no Vektra, or an outdated one.
            () => false,
          ),
    ),
  );
  return answers.some(Boolean);
}

/** Reload Vektra now, or once no bot game is in progress (checked every minute). */
export async function reloadWhenIdle(): Promise<void> {
  if (await gameInProgress()) {
    await chrome.alarms.create(RELOAD_ALARM, { delayInMinutes: 1 });
    return;
  }
  chrome.runtime.reload();
}

/**
 * Ask GitHub for the latest release (unless asked within CHECK_INTERVAL_MS,
 * or `force`), and install it when "Update automatically" is on and the
 * helper is there. Also notices a newer version already in the folder and
 * reloads into it.
 */
export async function checkForUpdate({ force = false } = {}): Promise<UpdateState> {
  const settings = await loadSettings();
  const state = await serial(async () => {
    const folder = await folderVersion();
    if (folder && compareVersions(folder, runningVersion()) > 0) {
      const waiting = await writeState({ phase: 'waiting', installed: folder });
      void reloadWhenIdle();
      return waiting;
    }
    let current = await readState();
    // Left over from before the last reload, or from a worker that stopped mid-install.
    if (current.phase === 'waiting' || current.phase === 'installing') {
      current = await writeState({ phase: 'idle', installed: undefined });
    }
    if (!settings.updateCheck) return current;
    current = await writeState({ helper: await helperAnswers() });
    if (!force && Date.now() - current.checkedAt < CHECK_INTERVAL_MS) return current;
    try {
      const response = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
      // 404: no release published yet. Other failures keep what was known.
      if (response.ok || response.status === 404) {
        const latest = response.ok ? parseRelease(await response.json()) : null;
        current = await writeState({ checkedAt: Date.now(), latest });
      }
    } catch {
      // Offline; asked again next time.
    }
    return current;
  });
  const failedBefore = state.phase === 'error' && state.failedVersion === state.latest?.version;
  if (
    settings.autoUpdate &&
    state.helper &&
    !failedBefore &&
    (state.phase === 'idle' || state.phase === 'error') &&
    updateAvailable(state, runningVersion())
  ) {
    return installUpdate();
  }
  return state;
}

/** Have the helper install the latest release, then reload into it. */
export function installUpdate(): Promise<UpdateState> {
  return serial(async () => {
    const state = await readState();
    if (state.phase === 'installing' || state.phase === 'waiting' || !updateAvailable(state, runningVersion())) {
      return state;
    }
    const version = state.latest!.version;
    await writeState({ phase: 'installing', error: undefined, failedVersion: undefined });
    try {
      const reply = (await chrome.runtime.sendNativeMessage(UPDATER_HOST, { type: 'update' })) as
        | { ok?: boolean; error?: string }
        | undefined;
      if (!reply?.ok) throw new Error(reply?.error ?? 'The updater did not answer.');
      const folder = await folderVersion();
      if (!folder || compareVersions(folder, runningVersion()) <= 0) {
        throw new Error('The updater finished, but no newer version is in the Vektra folder.');
      }
      const waiting = await writeState({ phase: 'waiting', installed: folder });
      void reloadWhenIdle();
      return waiting;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Vektra] The update failed:', message);
      return writeState({ phase: 'error', error: message, failedVersion: version });
    }
  });
}

/** Wire the update checks into the background worker; call once. */
export function startUpdates(): void {
  // Each time Chrome starts, and after Vektra is installed, updated or
  // reloaded; these are rare, so GitHub is always asked.
  chrome.runtime.onStartup.addListener(() => void checkForUpdate({ force: true }));
  chrome.runtime.onInstalled.addListener((details) => {
    // A reload of the same version also reports "update"; only a new version counts.
    const to = runningVersion();
    if (details.reason === 'update' && details.previousVersion && details.previousVersion !== to) {
      void chrome.storage.local.set({ [UPDATED_NOTE_KEY]: { from: details.previousVersion, to } });
    }
    void checkForUpdate({ force: true });
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RELOAD_ALARM) void reloadWhenIdle();
  });
}
