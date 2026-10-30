import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisPanel } from '../src/ui/analysisPanel';

afterEach(() => {
  document.getElementById('vektra-analysis-panel')?.remove();
  vi.unstubAllGlobals();
});

describe('analysis panel status', () => {
  it('lets keyboard users expand and collapse the panel', async () => {
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => path },
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    });
    const panel = new AnalysisPanel({
      onAnalyze: vi.fn(),
      onCancel: vi.fn(),
      onExport: vi.fn(),
      onExportPdf: vi.fn(),
      onSelectPly: vi.fn(),
    });
    const header = document.querySelector<HTMLElement>('#vektra-analysis-panel [role="button"]')!;
    const body = document.getElementById('vektra-analysis-panel-content')!;
    await Promise.resolve();

    expect(header.getAttribute('aria-expanded')).toBe('true');
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(body.style.display).toBe('none');
    panel.destroy();
  });

  it('exposes accessible progress and a clear cancellation message', async () => {
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => path },
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    });
    const panel = new AnalysisPanel({
      onAnalyze: vi.fn(),
      onCancel: vi.fn(),
      onExport: vi.fn(),
      onExportPdf: vi.fn(),
      onSelectPly: vi.fn(),
    });

    panel.showProgress(2, 5);
    const progress = document.querySelector<HTMLElement>('[role="progressbar"]');
    expect(progress?.getAttribute('aria-label')).toBe('Game analysis progress');
    expect(progress?.getAttribute('aria-valuenow')).toBe('2');
    expect(document.getElementById('vektra-analysis-panel')?.textContent).toContain('2 of 5');

    panel.showIdle(5, false, 'Analysis cancelled.');
    expect(document.getElementById('vektra-analysis-panel')?.textContent).toContain('Analysis cancelled.');
    panel.destroy();
  });
});
