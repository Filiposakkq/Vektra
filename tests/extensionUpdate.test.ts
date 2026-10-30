import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeChrome } from './fixtures/chrome';

const CHUNK_ERROR = new TypeError(
  'Failed to fetch dynamically imported module: chrome-extension://test/assets/openingBook-B9RXf5qM.js',
);

async function helpers() {
  vi.resetModules();
  const mod = await import('../src/content/extensionUpdate');
  const notice = { show: vi.fn() };
  const reload = vi.fn();
  mod.setReloadNotice(notice, reload);
  return { ...mod, notice, reload };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reload notice for an outdated page', () => {
  it('handles a failed chunk load: one reload notice, logged once, nothing remembered', async () => {
    installFakeChrome();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await helpers();
    expect(h.handleStaleExtension(CHUNK_ERROR)).toBe(true);
    expect(h.handleStaleExtension(CHUNK_ERROR)).toBe(true);
    expect(h.notice.show).toHaveBeenLastCalledWith(CHUNK_ERROR.message, h.reload, { text: h.UPDATED_TEXT, action: 'Reload' });
    expect(warn).toHaveBeenCalledOnce();
    h.notice.show.mock.calls[0][1]();
    expect(h.reload).toHaveBeenCalledOnce();
  });

  it('treats any failure as outdated once the extension context is gone', async () => {
    const fake = installFakeChrome();
    (fake.chrome.runtime as { id?: string }).id = undefined;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await helpers();
    expect(h.handleStaleExtension(new Error('anything'))).toBe(true);
    vi.stubGlobal('chrome', {});
    expect(h.extensionContextValid()).toBe(false);
  });

  it('leaves other errors to the caller', async () => {
    installFakeChrome();
    const h = await helpers();
    expect(h.handleStaleExtension(new Error('isBookLine failed'))).toBe(false);
    expect(h.notice.show).not.toHaveBeenCalled();
  });

  it('offers a reload for any analysis-tools load failure', async () => {
    installFakeChrome();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = await helpers();
    h.reportAnalysisLoadFailure(new Error('network down'));
    expect(h.notice.show.mock.calls[0][2]).toEqual({ text: h.ANALYSIS_LOAD_TEXT, action: 'Reload' });
    expect(error).toHaveBeenCalled();
  });
});
