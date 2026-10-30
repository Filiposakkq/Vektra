import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineErrorNotice } from '../src/ui/engineErrorNotice';

afterEach(() => {
  document.getElementById('vektra-engine-error')?.remove();
});

describe('engine error notice', () => {
  it('offers a clear retry action and clears after recovery', () => {
    const notice = new EngineErrorNotice();
    const retry = vi.fn();
    notice.show('worker failed', retry);
    const root = document.getElementById('vektra-engine-error')!;
    const button = root.querySelector('button')!;

    expect(root.textContent).toContain('could not run the chess engine');
    expect(root.title).toBe('worker failed');
    button.click();
    expect(retry).toHaveBeenCalledOnce();
    notice.clear();
    expect(root.style.display).toBe('none');
    notice.destroy();
  });

  it('can carry other wording and action, and goes back to the engine wording', () => {
    const notice = new EngineErrorNotice();
    const reload = vi.fn();
    notice.show('chunk missing', reload, { text: 'Vektra was updated. Reload this page.', action: 'Reload' });
    const root = document.getElementById('vektra-engine-error')!;
    const button = root.querySelector('button')!;
    expect(root.textContent).toContain('Vektra was updated');
    expect(button.textContent).toBe('Reload');
    button.click();
    expect(reload).toHaveBeenCalledOnce();

    notice.show('worker failed', vi.fn());
    expect(root.textContent).toContain('could not run the chess engine');
    expect(button.textContent).toBe('Retry');
    notice.destroy();
  });
});
