/**
 * Updates from Vektra's GitHub releases. The background worker checks for a
 * new release and, through the updater helper (public/updater), installs it
 * and reloads Vektra; the popup shows where that stands. Without the helper
 * the popup links to the release to download by hand.
 */

export const RELEASES_URL = 'https://github.com/Filiposakkq/Vektra/releases';
export const LATEST_RELEASE_API = 'https://api.github.com/repos/Filiposakkq/Vektra/releases/latest';
/** The updater helper's name, as install-updater.ps1 registers it with Chrome. */
export const UPDATER_HOST = 'com.vektra.updater';

/** Where the background worker keeps the UpdateState, in chrome.storage.local. */
export const UPDATE_STATE_KEY = 'updateState';
/** Popup -> background: check now (unless checked recently); replies with the UpdateState. */
export const UPDATE_CHECK = 'vektra:update-check';
/** Popup -> background: install the new release through the helper. */
export const UPDATE_INSTALL = 'vektra:update-install';
/** Background -> content script: is a bot game in progress in this tab? Replies a boolean. */
export const GAME_IN_PROGRESS = 'vektra:game-in-progress';

export interface UpdateState {
  /** When GitHub was last asked (ms since 1970), 0 if never. */
  checkedAt: number;
  /** The latest release, if one was found. */
  latest: { version: string; url: string } | null;
  /** Whether the updater helper answered the last time it was asked. */
  helper: boolean;
  /**
   * - idle:       nothing under way
   * - installing: the helper is installing `latest`
   * - waiting:    a newer version is in the folder; Vektra reloads once no bot game is in progress
   * - error:      the last install failed (see `error`)
   */
  phase: 'idle' | 'installing' | 'waiting' | 'error';
  /** With phase "error": why, and which version failed (not retried on its own). */
  error?: string;
  failedVersion?: string;
  /** With phase "waiting": the version in the folder. */
  installed?: string;
}

export const EMPTY_UPDATE_STATE: UpdateState = { checkedAt: 0, latest: null, helper: false, phase: 'idle' };

/** Compare dotted versions ("0.10.0" > "0.9.2"); negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** The version and page of a GitHub "latest release" reply, or null if it isn't one. */
export function parseRelease(json: unknown): UpdateState['latest'] {
  if (!json || typeof json !== 'object') return null;
  const { tag_name: tag, html_url: url } = json as Record<string, unknown>;
  if (typeof tag !== 'string' || !/^v?\d+(\.\d+)*$/.test(tag)) return null;
  return { version: tag.replace(/^v/, ''), url: typeof url === 'string' ? url : RELEASES_URL };
}

/** True when `state` knows of a release newer than `running`. */
export function updateAvailable(state: UpdateState, running: string): boolean {
  return !!state.latest && compareVersions(state.latest.version, running) > 0;
}
