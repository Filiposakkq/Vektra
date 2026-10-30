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
});
