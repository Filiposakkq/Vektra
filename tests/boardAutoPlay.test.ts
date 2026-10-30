import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardAutoPlayControl } from '../src/ui/boardAutoPlay';

describe('board autoplay control', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows an explicit state and calls back when toggled', () => {
    const onToggle = vi.fn();
    const control = new BoardAutoPlayControl(onToggle, vi.fn());
    const board = document.createElement('wc-chess-board');
    document.body.append(board);
    control.update(board, false, false);
    const root = board.querySelector('div')?.shadowRoot;
    const button = root?.querySelector<HTMLButtonElement>('button');

    expect(button?.textContent).toBe('AUTO · OFF');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    button?.click();
    expect(onToggle).toHaveBeenCalledWith(true);

    control.update(board, true, false);
    expect(button?.textContent).toBe('AUTO · ON');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    control.destroy();
    expect(board.querySelector('.vektra-autoplay-control')).toBeNull();
  });

  it('shows and toggles the occasional weaker-move state', () => {
    const onWeakerToggle = vi.fn();
    const control = new BoardAutoPlayControl(vi.fn(), onWeakerToggle);
    const board = document.createElement('wc-chess-board');
    document.body.append(board);
    control.update(board, false, false);
    const button = board
      .querySelector('div')
      ?.shadowRoot?.querySelectorAll<HTMLButtonElement>('button')[1];

    expect(button?.textContent).toBe('WEAKER · OFF');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    button?.click();
    expect(onWeakerToggle).toHaveBeenCalledWith(true);

    control.update(board, false, true);
    expect(button?.textContent).toBe('WEAKER · ON');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    button?.click();
    expect(onWeakerToggle).toHaveBeenLastCalledWith(false);
    control.destroy();
  });

  it('shows engine think time and selected move delay in seconds', () => {
    const control = new BoardAutoPlayControl(vi.fn(), vi.fn());
    const board = document.createElement('wc-chess-board');
    control.update(board, false, false);
    const root = board
      .querySelector('.vektra-autoplay-control')
      ?.shadowRoot;
    const thinkTime = root?.querySelector<HTMLElement>('.think-time');
    const moveDelay = root?.querySelector<HTMLElement>('.move-delay');

    expect(root?.querySelector('.times')?.hasAttribute('hidden')).toBe(true);
    const detailsToggle = root?.querySelector<HTMLButtonElement>('.details-toggle');
    expect(detailsToggle?.textContent).toBe('Details');
    expect(detailsToggle?.getAttribute('aria-label')).toBe('Show move details');
    detailsToggle?.click();
    expect(root?.querySelector('.times')?.hasAttribute('hidden')).toBe(false);
    expect(detailsToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(thinkTime?.textContent).toBe('Think: —');
    expect(moveDelay?.textContent).toBe('Delay: —');
    control.setThinkTime(832);
    expect(thinkTime?.textContent).toBe('Think: 0.83 s');
    control.setThinkTime(1250);
    expect(thinkTime?.textContent).toBe('Think: 1.25 s');
    control.setMoveDelay(1750);
    expect(moveDelay?.textContent).toBe('Delay: 1.75 s');
    control.setMoveDelay(null);
    expect(moveDelay?.textContent).toBe('Delay: —');
    const suggestion = root?.querySelector<HTMLElement>('.suggestion');
    expect(suggestion?.textContent).toBe('Pick: —');
    control.setSuggestion('Nf3', 42);
    expect(suggestion?.textContent).toBe('Pick: Nf3 (−0.42)');
    control.setSuggestion('e4', 0);
    expect(suggestion?.textContent).toBe('Pick: e4');
    control.destroy();
  });
});
