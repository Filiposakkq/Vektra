import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingSettings } from '../src/ui/floatingSettings';

afterEach(() => {
  document.getElementById('vektra-floating-settings')?.remove();
  vi.unstubAllGlobals();
});

function stubExtension() {
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
  });
}

describe('floating settings window', () => {
  it('loads the existing settings UI in a floating extension frame', () => {
    stubExtension();
    const settings = new FloatingSettings(vi.fn(), vi.fn());
    const host = document.getElementById('vektra-floating-settings')!;
    const frame = host.shadowRoot?.querySelector<HTMLIFrameElement>('iframe');

    expect(host.shadowRoot?.querySelector('.window')).not.toBeNull();
    expect(frame?.title).toBe('Vektra settings');
    expect(frame?.src).toBe('chrome-extension://test/src/popup/index.html?floating=1&context=game');
    expect(host.shadowRoot?.querySelector('.resize-handle')).toBeNull();
    settings.destroy();
    expect(document.getElementById('vektra-floating-settings')).toBeNull();
  });

  it('removes manual resizing and waits for the settings page to report its content size', () => {
    stubExtension();
    new FloatingSettings(vi.fn(), vi.fn());
    const host = document.getElementById('vektra-floating-settings')!;
    const root = host.shadowRoot!;
    const frame = root.querySelector('iframe')!;

    expect(frame).not.toBeNull();
    expect(frame.style.height).toBe('');
    expect(root.querySelector('[aria-label="Resize Vektra settings"]')).toBeNull();
  });

  it('keeps a launcher after closing and reopens the settings window', () => {
    stubExtension();
    new FloatingSettings(vi.fn(), vi.fn());
    const root = document.getElementById('vektra-floating-settings')!.shadowRoot!;
    const window = root.querySelector<HTMLElement>('.window')!;
    const launcher = root.querySelector<HTMLButtonElement>('#vektra-settings-launcher')!;

    root.querySelector<HTMLButtonElement>('button[aria-label="Close Vektra settings"]')!.click();
    expect(window.hidden).toBe(true);
    expect(launcher.hidden).toBe(false);
    expect(launcher.getAttribute('aria-expanded')).toBe('false');

    launcher.click();
    expect(window.hidden).toBe(false);
    expect(launcher.hidden).toBe(true);
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
  });

  it('routes the hint button through the content-script callback', () => {
    stubExtension();
    const onShowHint = vi.fn();
    new FloatingSettings(onShowHint, vi.fn());
    document
      .querySelector('#vektra-floating-settings')
      ?.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Show hint now"]')
      ?.click();

    expect(onShowHint).toHaveBeenCalledOnce();
  });

  it('shows an immediate stop control only while autoplay is enabled', () => {
    stubExtension();
    const onStopAutoplay = vi.fn();
    const settings = new FloatingSettings(vi.fn(), onStopAutoplay);
    const stop = document
      .querySelector('#vektra-floating-settings')
      ?.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Stop autoplay"]')!;

    expect(stop.hidden).toBe(true);
    settings.setAutoplayEnabled(true);
    expect(stop.hidden).toBe(false);
    stop.click();
    expect(stop.hidden).toBe(true);
    expect(onStopAutoplay).toHaveBeenCalledOnce();
  });

  it('updates the context-specific starting tab', () => {
    stubExtension();
    const settings = new FloatingSettings(vi.fn(), vi.fn(), 'game');
    const host = document.getElementById('vektra-floating-settings')!;
    const frame = host.shadowRoot?.querySelector<HTMLIFrameElement>('iframe')!;
    expect(new URL(frame.src).searchParams.get('context')).toBe('game');
    settings.setContext('analysis');
    expect(new URL(frame.src).searchParams.get('context')).toBe('analysis');
    settings.destroy();
  });
});
