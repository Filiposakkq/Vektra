import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisPanel } from '@ext/ui/analysisPanel';
import { installFakeChrome } from '../fixtures/chrome';

afterEach(() => {
  document.getElementById('vektra-analysis-panel')?.remove();
  vi.unstubAllGlobals();
});

describe('analysis panel status', () => {
  it('lets keyboard users expand and collapse the panel', async () => {
    installFakeChrome({ baseUrl: '' });
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
    installFakeChrome({ baseUrl: '' });
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

  it('opens as its own window beside the board, on the side with room', () => {
    installFakeChrome({ baseUrl: '' });
    const callbacks = { onAnalyze: vi.fn(), onCancel: vi.fn(), onExport: vi.fn(), onExportPdf: vi.fn(), onSelectPly: vi.fn() };
    const board = document.createElement('div');
    document.body.append(board);
    let rect = new DOMRect(100, 80, 500, 500);
    board.getBoundingClientRect = () => rect;
    const panel = new AnalysisPanel(callbacks, () => board);
    const root = () => document.getElementById('vektra-analysis-panel')!;
    expect(root().parentElement).toBe(document.body);
    expect(root().style.position).toBe('fixed');
    // Room on the right of the board (the window is 1024 px wide here).
    expect(root().style.left).toBe('616px');
    expect(root().style.top).toBe('80px');
    panel.destroy();

    // No room on the right: it goes to the left of the board.
    rect = new DOMRect(500, 80, 500, 500);
    const left = new AnalysisPanel(callbacks, () => board);
    expect(root().style.left).toBe('144px');
    left.destroy();
    board.remove();
  });
});
