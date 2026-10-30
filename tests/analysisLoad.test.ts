import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionContextValid, reportAnalysisLoadFailure } from '../src/content/analysisLoad';
import { installFakeChrome } from './fixtures/chrome';

const CHUNK_ERROR = new TypeError(
  'Failed to fetch dynamically imported module: chrome-extension://test/assets/analysisController-D_1DfGIl.js',
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('analysis tools load failure', () => {
  it('asks to reload the page when the extension was updated under it', () => {
    const fake = installFakeChrome();
    // What a content script left behind by an extension reload sees.
    (fake.chrome.runtime as { id?: string }).id = undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notice = { show: vi.fn() };
    const reload = vi.fn();

    reportAnalysisLoadFailure(CHUNK_ERROR, notice, reload);

    expect(notice.show).toHaveBeenCalledWith(CHUNK_ERROR.message, reload, {
      text: 'Vektra was updated. Reload this page to use game analysis.',
      action: 'Reload',
    });
    expect(warn).toHaveBeenCalled();
    notice.show.mock.calls[0][1]();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('offers a reload for other failures too, and logs them as errors', () => {
    installFakeChrome();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notice = { show: vi.fn() };

    reportAnalysisLoadFailure(new Error('network down'), notice, vi.fn());

    expect(notice.show.mock.calls[0][2]).toEqual({
      text: 'Vektra could not load its game analysis tools. Reload this page to try again.',
      action: 'Reload',
    });
    expect(error).toHaveBeenCalledWith('[Vektra] Could not load game analysis tools:', expect.any(Error));
  });

  it('treats a missing or throwing chrome.runtime as an updated extension', () => {
    vi.stubGlobal('chrome', {});
    expect(extensionContextValid()).toBe(false);
    vi.stubGlobal('chrome', {
      get runtime() {
        throw new Error('Extension context invalidated.');
      },
    });
    expect(extensionContextValid()).toBe(false);
    installFakeChrome();
    expect(extensionContextValid()).toBe(true);
  });
});
