import { describe, expect, it } from 'vitest';
import {
  arrowScoreLabel,
  MAX_ALTERNATIVE_WIN_LOSS,
  nullMoveFen,
  scoreArrows,
} from '../src/content/hints';
import type { PvLine } from '../src/engine/uci';
import { BoardOverlay, lossFade, THREAT_ARROW_COLOR } from '../src/ui/overlay';

const line = (move: string, multipv: number, value: number): PvLine => ({
  multipv,
  depth: 12,
  score: { type: 'cp', value },
  pv: [move],
});

const withBoard = (fn: (board: HTMLElement, overlay: BoardOverlay) => void) => {
  const board = document.createElement('wc-chess-board');
  document.body.append(board);
  const overlay = new BoardOverlay(board);
  try {
    fn(board, overlay);
  } finally {
    overlay.destroy();
    board.remove();
  }
};

describe('arrow scores', () => {
  it('prints short scores from White’s point of view', () => {
    expect(arrowScoreLabel({ type: 'cp', value: 84 })).toBe('+0.8');
    expect(arrowScoreLabel({ type: 'cp', value: -130 })).toBe('-1.3');
    expect(arrowScoreLabel({ type: 'cp', value: 3 })).toBe('0.0');
    expect(arrowScoreLabel({ type: 'mate', value: 3 })).toBe('M3');
    expect(arrowScoreLabel({ type: 'mate', value: -2 })).toBe('-M2');
  });

  it('labels arrows and fades alternatives by the win chance they give up', () => {
    const lines = [line('e2e4', 1, 40), line('d2d4', 2, 25)];
    const scored = scoreArrows(
      [{ move: 'e2e4', rank: 0 }, { move: 'd2d4', rank: 1 }],
      lines,
      'w',
      { showScores: true, hideWorse: true },
    );
    expect(scored[0]).toEqual({ move: 'e2e4', rank: 0, label: '+0.4' });
    expect(scored[1].label).toBe('+0.3');
    expect(scored[1].winLoss).toBeGreaterThan(0);
    expect(scored[1].winLoss).toBeLessThan(MAX_ALTERNATIVE_WIN_LOSS);
  });

  it('shows scores for Black from White’s point of view', () => {
    const [arrow] = scoreArrows([{ move: 'e7e5', rank: 0 }], [line('e7e5', 1, 50)], 'b', {
      showScores: true,
      hideWorse: true,
    });
    expect(arrow.label).toBe('-0.5');
  });

  it('drops normal alternatives that give up too much, but keeps them when every line was asked for', () => {
    const lines = [line('e2e4', 1, 30), line('d2d4', 2, 20), line('f2f3', 3, -250)];
    const arrows = [
      { move: 'e2e4', rank: 0 },
      { move: 'd2d4', rank: 1 },
      { move: 'f2f3', rank: 2 },
    ];
    expect(scoreArrows(arrows, lines, 'w', { showScores: false, hideWorse: true }).map((a) => a.move)).toEqual([
      'e2e4',
      'd2d4',
    ]);
    expect(scoreArrows(arrows, lines, 'w', { showScores: false, hideWorse: false })).toHaveLength(3);
  });

  it('never drops the primary move or a selected weaker move', () => {
    const lines = [line('e2e4', 1, 300), line('f2f3', 2, -300)];
    const scored = scoreArrows(
      [{ move: 'f2f3', rank: 0, weaker: true }, { move: 'e2e4', rank: 1 }],
      lines,
      'w',
      { showScores: false, hideWorse: true },
    );
    expect(scored.map((a) => a.move)).toEqual(['f2f3', 'e2e4']);
    expect(scored[0].winLoss).toBeUndefined();
  });

  it('leaves out labels when scores are turned off', () => {
    const [arrow] = scoreArrows([{ move: 'e2e4', rank: 0 }], [line('e2e4', 1, 30)], 'w', {
      showScores: false,
      hideWorse: true,
    });
    expect(arrow.label).toBeUndefined();
  });
});

describe('threat position', () => {
  it('passes the move to the other side and clears en passant', () => {
    expect(nullMoveFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
    );
  });

  it('is not possible while in check', () => {
    expect(nullMoveFen('rnb1kbnr/pppp1ppp/8/4p3/5PPq/8/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toBeNull();
  });
});

describe('overlay drawing', () => {
  it('fades by win-chance loss, down to a floor', () => {
    expect(lossFade(undefined)).toBe(1);
    expect(lossFade(5)).toBeLessThan(1);
    expect(lossFade(50)).toBeCloseTo(0.45);
  });

  it('prints a score pill for labelled arrows, above every arrow', () => {
    withBoard((board, overlay) => {
      overlay.draw(board, [{ move: 'e2e4', rank: 0, label: '+0.4' }, { move: 'd2d4', rank: 1 }], false);
      const labels = board.querySelectorAll('.vektra-score-label');
      expect(labels).toHaveLength(1);
      expect(labels[0].textContent).toBe('+0.4');
      expect(board.querySelector('svg.vektra-overlay')?.lastElementChild).toBe(labels[0]);
    });
  });

  it('stacks the scores of arrows that end on the same square, best lowest', () => {
    withBoard((board, overlay) => {
      overlay.draw(
        board,
        [
          { move: 'c2c3', rank: 1, label: '+0.5' },
          { move: 'b1c3', rank: 0, label: '+1.0' },
        ],
        false,
      );
      const y = (text: string) =>
        Number([...board.querySelectorAll('.vektra-score-label')].find((l) => l.textContent === text)
          ?.querySelector('rect')?.getAttribute('y'));
      expect(y('+1.0')).toBeGreaterThan(y('+0.5'));
    });
  });

  it('draws a line of play numbered in one colour', () => {
    withBoard((board, overlay) => {
      overlay.colors = ['#111111', '#222222', '#333333'];
      overlay.draw(
        board,
        [
          { move: 'e2e4', rank: 0, step: 1 },
          { move: 'e7e5', rank: 1, step: 2 },
          { move: 'g1f3', rank: 2, step: 3 },
        ],
        false,
      );
      const strokes = [...board.querySelectorAll('.vektra-move .vektra-arrow-line')].map((l) => l.getAttribute('stroke'));
      expect(new Set(strokes)).toEqual(new Set(['#111111']));
      expect([...board.querySelectorAll('.vektra-step-marker')].map((m) => m.textContent).sort()).toEqual(['1', '2', '3']);
      // Only the move now gets its squares highlighted.
      expect(board.querySelectorAll('.vektra-square-highlight')).toHaveLength(2);
    });
  });

  it('draws a threat in red, underneath and without square highlights', () => {
    withBoard((board, overlay) => {
      overlay.draw(board, [{ move: 'e2e4', rank: 0 }, { move: 'd8h4', rank: 0, threat: true }], false);
      const threat = board.querySelector<SVGGElement>('.vektra-threat');
      expect(threat?.querySelector('.vektra-arrow-line')?.getAttribute('stroke')).toBe(THREAT_ARROW_COLOR);
      expect(threat?.querySelector('.vektra-square-highlight')).toBeNull();
      const groups = [...board.querySelectorAll('svg.vektra-overlay > g')];
      expect(groups.indexOf(threat!)).toBeLessThan(groups.indexOf(board.querySelector('.vektra-move')!));
    });
  });

  it('can highlight only the piece to move', () => {
    withBoard((board, overlay) => {
      overlay.draw(board, [], false);
      overlay.drawPieceHint(board, 'g1', false);
      expect(board.querySelector('.vektra-piece-hint')?.getAttribute('data-square')).toBe('g1');
      expect(board.querySelectorAll('polygon')).toHaveLength(0);
    });
  });
});
