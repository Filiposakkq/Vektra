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
  const white = () => root()!.querySelector<HTMLElement>('.vektra-evalbar-white')!;
  const label = () => root()!.querySelector<HTMLElement>('.vektra-evalbar-score')!;
  const depth = () => root()!.querySelector<HTMLElement>('.vektra-evalbar-depth')!;
  return { board, bar, root, white, label, depth };
}

const probe = document.createElement('div');
const css = (color: string) => ((probe.style.color = color), probe.style.color);

describe('eval bar', () => {
  it("attaches to the board and fills White's share from White's side", () => {
    const { board, bar, root, white, label } = setup();
    bar.update(board, { type: 'cp', value: 150 }, false);

    expect(root()?.parentElement).toBe(board);
    const pct = winPercent({ type: 'cp', value: 150 });
    expect(white().style.height).toBe(`${pct}%`);
    expect(white().style.bottom).toBe('0px');
    expect(label().textContent).toBe('1.5');
    // The score rides on the edge between the shares: Black's share is on top.
    expect(label().style.top).toContain(`${100 - pct}%`);
    expect(root()!.title).toBe('Eval +1.50');
  });

  it('flips with the board', () => {
    const { board, bar, white, label } = setup();
    bar.update(board, { type: 'cp', value: -230 }, true);
    const pct = winPercent({ type: 'cp', value: -230 });

    expect(white().style.top).toBe('0px');
    expect(label().textContent).toBe('2.3');
    expect(label().style.top).toContain(`${pct}%`);
  });

  it('colours the score in the colours of the side that is ahead', () => {
    const { board, bar, label } = setup();
    bar.update(board, { type: 'cp', value: 50 }, false);
    expect(label().style.background).toBe(css(THEME.bone));
    expect(label().style.color).toBe(css(THEME.oxblood));
    bar.update(board, { type: 'cp', value: -50 }, false);
    expect(label().style.background).toBe(css(THEME.ink));
    expect(label().style.color).toBe(css(THEME.bone));
  });

  it('shows a forced mate as a full bar with M and the distance', () => {
    const { board, bar, white, label } = setup();
    bar.update(board, { type: 'mate', value: 3 }, false);
    expect(white().style.height).toBe('100%');
    expect(label().textContent).toBe('M3');
    // Kept inside the bar at the very top.
    expect(label().style.top).toBe('3%');

    bar.update(board, { type: 'mate', value: -2 }, false);
    expect(white().style.height).toBe('0%');
    expect(label().textContent).toBe('M2');
  });

  it('puts the search depth at the end away from the score', () => {
    const { board, bar, depth } = setup();
    bar.update(board, { type: 'cp', value: 400 }, false, 14);
    expect(depth().textContent).toBe('d14');
    // White is well ahead: the score is near the top, the depth at the bottom.
    expect(depth().style.bottom).toBe('4px');
    bar.update(board, { type: 'cp', value: -400 }, false, 15);
    expect(depth().style.top).toBe('4px');
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
