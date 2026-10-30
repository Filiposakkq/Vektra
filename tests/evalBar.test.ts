import { afterEach, describe, expect, it } from 'vitest';
import { winPercent } from '../src/analysis/winProbability';
import { THEME } from '../src/ui/theme';
import { EvalBar } from '../src/ui/evalBar';

afterEach(() => document.body.replaceChildren());

function setup() {
  const board = document.createElement('div');
  document.body.append(board);
  const bar = new EvalBar();
  const root = () => board.querySelector<HTMLElement>('.vektra-evalbar');
  const white = () => root()!.children[0] as HTMLElement;
  const label = () => root()!.children[1] as HTMLElement;
  return { board, bar, root, white, label };
}

describe('eval bar', () => {
  it("attaches to the board and fills White's share from White's side", () => {
    const { board, bar, root, white, label } = setup();
    bar.update(board, { type: 'cp', value: 150 }, false);

    expect(root()?.parentElement).toBe(board);
    expect(white().style.height).toBe(`${winPercent({ type: 'cp', value: 150 })}%`);
    expect(white().style.bottom).toBe('0px');
    expect(label().textContent).toBe('1.5');
    // White is ahead: the label sits at White's end (the bottom).
    expect(label().style.bottom).toBe('4px');
    expect(root()!.title).toBe('Eval +1.50');
  });

  it('flips with the board and labels the side that is ahead', () => {
    const { board, bar, white, label } = setup();
    bar.update(board, { type: 'cp', value: -230 }, true);

    expect(white().style.top).toBe('0px');
    expect(label().textContent).toBe('2.3');
    // Black is ahead and, flipped, Black's end is the bottom.
    expect(label().style.bottom).toBe('4px');
  });

  it('colours the label for the side that is ahead', () => {
    const { board, bar, label } = setup();
    const probe = document.createElement('div');
    const css = (color: string) => ((probe.style.color = color), probe.style.color);
    bar.update(board, { type: 'cp', value: 50 }, false);
    expect(label().style.color).toBe(css(THEME.oxblood));
    bar.update(board, { type: 'cp', value: -50 }, false);
    expect(label().style.color).toBe(css(THEME.bone));
  });

  it('shows a forced mate as a full bar with M and the distance', () => {
    const { board, bar, white, label } = setup();
    bar.update(board, { type: 'mate', value: 3 }, false);
    expect(white().style.height).toBe('100%');
    expect(label().textContent).toBe('M3');

    bar.update(board, { type: 'mate', value: -2 }, false);
    expect(white().style.height).toBe('0%');
    expect(label().textContent).toBe('M2');
    expect(label().style.top).toBe('4px');
  });

  it("steps aside while chess.com's own bar is showing", () => {
    const { board, bar, root } = setup();
    const native = document.createElement('wc-evaluation-bar');
    Object.defineProperty(native, 'offsetWidth', { value: 20 });
    document.body.append(native);
    bar.update(board, { type: 'cp', value: 0 }, false);
    expect(root()!.style.display).toBe('none');

    native.remove();
    bar.update(board, { type: 'cp', value: 0 }, false);
    expect(root()!.style.display).toBe('');
  });

  it('moves to a new board element and is removed by destroy', () => {
    const { board, bar, root } = setup();
    bar.update(board, { type: 'cp', value: 10 }, false);
    const other = document.createElement('div');
    document.body.append(other);
    bar.update(other, { type: 'cp', value: 10 }, false);
    expect(root()).toBeNull();
    expect(other.querySelector('.vektra-evalbar')).not.toBeNull();
    bar.destroy();
    expect(other.querySelector('.vektra-evalbar')).toBeNull();
  });
});
