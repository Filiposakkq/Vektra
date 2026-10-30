/**
 * What to show when the game analysis tools (loaded on demand) fail to load.
 * The usual cause is a page still running Vektra's previous content script
 * after the extension was updated or reloaded: its analysis file no longer
 * exists, and only reloading the page loads the new version.
 */

/** False once the extension was reloaded or updated under this page. */
export function extensionContextValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export interface LoadFailureNotice {
  show(detail: string, onAction: () => void, options: { text: string; action: string }): void;
}

/** Log a failed load of the analysis tools and offer to reload the page. */
export function reportAnalysisLoadFailure(
  error: unknown,
  notice: LoadFailureNotice,
  reload: () => void = () => location.reload(),
): void {
  const updated = !extensionContextValid();
  const detail = error instanceof Error ? error.message : String(error);
  if (updated) console.warn('[Vektra] Vektra was updated; reload the page to use game analysis.', error);
  else console.error('[Vektra] Could not load game analysis tools:', error);
  notice.show(detail, reload, {
    text: updated
      ? 'Vektra was updated. Reload this page to use game analysis.'
      : 'Vektra could not load its game analysis tools. Reload this page to try again.',
    action: 'Reload',
  });
}
