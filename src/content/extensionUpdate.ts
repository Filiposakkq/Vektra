/**
 * Parts of the content script are loaded on demand (game analysis, the
 * opening book, PDF export) from files whose names change with every build.
 * A page still running the previous content script after Vektra was updated
 * or reloaded asks for files that no longer exist, and only reloading the
 * page fixes it. These helpers turn that failure into one clear notice.
 */

/** What a browser says when a dynamically imported file can't be loaded. */
const CHUNK_LOAD_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export const UPDATED_TEXT = 'Vektra was updated. Reload this page to keep using it.';
export const ANALYSIS_LOAD_TEXT = 'Vektra could not load its game analysis tools. Reload this page to try again.';

export interface ReloadNotice {
  show(detail: string, onAction: () => void, options: { text: string; action: string }): void;
}

let notice: ReloadNotice | null = null;
let reloadPage: () => void = () => location.reload();
let warned = false;

/** Where to show the reload notice (the content script's notice). */
export function setReloadNotice(target: ReloadNotice, reload: () => void = () => location.reload()): void {
  notice = target;
  reloadPage = reload;
}

/** False once the extension was reloaded or updated under this page. */
export function extensionContextValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/** True if `error` means this page runs an outdated copy of Vektra. */
export function isStaleExtensionError(error: unknown): boolean {
  return !extensionContextValid() || (error instanceof Error && CHUNK_LOAD_ERROR.test(error.message));
}

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * For a failed on-demand load: if the page runs an outdated copy of Vektra,
 * show the reload notice (logged once per page) and return true; otherwise
 * return false and leave the error to the caller. Nothing is remembered, so
 * later loads are tried again.
 */
export function handleStaleExtension(error: unknown): boolean {
  if (!isStaleExtensionError(error)) return false;
  if (!warned) {
    warned = true;
    console.warn('[Vektra] Vektra was updated; reload the page to keep using it.', error);
  }
  notice?.show(detailOf(error), reloadPage, { text: UPDATED_TEXT, action: 'Reload' });
  return true;
}

/** The game analysis tools failed to load: offer a reload either way. */
export function reportAnalysisLoadFailure(error: unknown): void {
  if (handleStaleExtension(error)) return;
  console.error('[Vektra] Could not load game analysis tools:', error);
  notice?.show(detailOf(error), reloadPage, { text: ANALYSIS_LOAD_TEXT, action: 'Reload' });
}
