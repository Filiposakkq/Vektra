import { describe, expect, it } from 'vitest';
import { arrowScoreLabel, steadyLines, scoreArrows } from '../src/content/hintArrows';
import { fenAfterMove, nullMoveFen } from '../src/content/gameHistory';
import type { PvLine } from '../src/engine/uci';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { fenAfter } from './fixtures/dom';
import { BOARD_COLORS, BoardOverlay, labelTextColor, lossFade, THREAT_ARROW_COLOR } from '../src/ui/overlay';

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
    expect(scored[1].winLoss).toBeLessThan(DEFAULT_SETTINGS.hideWorseWinLoss);
    expect(scored[1].fadeFullAt).toBe(DEFAULT_SETTINGS.hideWorseWinLoss);
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

describe('board visuals', () => {
  it('marks the piece a suggested promotion makes', () => {
    withBoard((board, overlay) => {
      overlay.draw(board, [{ move: 'e7e8n', rank: 0 }], false);
      const marker = board.querySelector<SVGGElement>('.vektra-promotion-marker');
      expect(marker?.dataset.piece).toBe('n');
      expect(marker?.textContent).toBe('N');
    });
  });

  it('tints both squares of the best move under the pieces, the target a bit more', () => {
    withBoard((board, overlay) => {
      board.append(Object.assign(document.createElement('div'), { className: 'piece wn square-71' }));
      overlay.draw(board, [{ move: 'g1f3', rank: 0 }], false);
      const from = board.querySelector('.vektra-square-highlight-from');
      const to = board.querySelector('.vektra-square-highlight-to');
      expect(to?.getAttribute('width')).toBe('1');
      expect(Number(to?.getAttribute('fill-opacity'))).toBeGreaterThan(Number(from?.getAttribute('fill-opacity')));
      // In their own layer, first in the board, so the pieces draw over them.
      const layer = to?.closest('svg');
      expect(layer?.classList.contains('vektra-underlay')).toBe(true);
      expect(board.firstElementChild).toBe(layer);
      expect(board.querySelector('svg.vektra-overlay .vektra-square-highlight')).toBeNull();
    });
  });

  it('uses dark text on light label colours', () => {
    expect(labelTextColor(BOARD_COLORS.saffron)).toBe(BOARD_COLORS.ink);
    expect(labelTextColor(BOARD_COLORS.lapis)).toBe('#fff');
  });
});

describe('adjustable thresholds', () => {
  it('hides and fades alternatives by the chosen win-chance limit', () => {
    const lines = [line('e2e4', 1, 30), line('d2d4', 2, -20), line('f2f3', 3, -120)];
    const arrows = [
      { move: 'e2e4', rank: 0 },
      { move: 'd2d4', rank: 1 },
      { move: 'f2f3', rank: 2 },
    ];
    const strict = scoreArrows(arrows, lines, 'w', { showScores: false, hideWorse: true, maxWinLoss: 3 });
    expect(strict.map((a) => a.move)).toEqual(['e2e4']);
    const loose = scoreArrows(arrows, lines, 'w', { showScores: false, hideWorse: true, maxWinLoss: 30 });
    expect(loose.map((a) => a.move)).toEqual(['e2e4', 'd2d4', 'f2f3']);
    expect(loose[2].fadeFullAt).toBe(30);
    expect(lossFade(15, 30)).toBeGreaterThan(lossFade(15, 10));
  });
});

describe('smooth redraws', () => {
  it('keeps an unchanged arrow and replaces a changed or removed one', () => {
    withBoard((board, overlay) => {
      overlay.draw(board, [{ move: 'e2e4', rank: 0 }, { move: 'd2d4', rank: 1 }], false);
      const first = board.querySelector('.vektra-move[data-move="e2e4"]');
      const second = board.querySelector('.vektra-move[data-move="d2d4"]');
      overlay.draw(board, [{ move: 'e2e4', rank: 0 }, { move: 'd2d4', rank: 1, provisional: true }], false);
      expect(board.querySelector('.vektra-move[data-move="e2e4"]')).toBe(first);
      expect(board.querySelector('.vektra-move[data-move="d2d4"]')).not.toBe(second);
      overlay.draw(board, [{ move: 'e2e4', rank: 0 }], false);
      expect(board.querySelectorAll('.vektra-move')).toHaveLength(1);
      expect(board.querySelector('.vektra-move')).toBe(first);
    });
  });

  it('starts fresh after a clear', () => {
    withBoard((board, overlay) => {
      overlay.draw(board, [{ move: 'e2e4', rank: 0 }], false);
      const first = board.querySelector('.vektra-move');
      overlay.clear();
      overlay.draw(board, [{ move: 'e2e4', rank: 0 }], false);
      expect(board.querySelector('.vektra-move')).not.toBe(first);
      expect(board.querySelectorAll('.vektra-move')).toHaveLength(1);
    });
  });
});

describe('thinking ahead', () => {
  it('finds the position after the predicted reply, as the board would report it', () => {
    // The cache only helps if this matches the board reader's FEN exactly.
    expect(fenAfterMove(fenAfter(['e4', 'e5', 'Nf3']), 'b8c6')).toBe(fenAfter(['e4', 'e5', 'Nf3', 'Nc6']));
    expect(fenAfterMove(fenAfter(['e4', 'd5', 'e5']), 'f7f5')).toBe(fenAfter(['e4', 'd5', 'e5', 'f5']));
    expect(fenAfterMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e5')).toBeNull();
  });
});

describe('steady arrows', () => {
  const shown = [line('e2e4', 1, 40), line('d2d4', 2, 35)];
  it('keeps the shown best move first when a new one is barely better', () => {
    const next = [line('d2d4', 1, 45), line('e2e4', 2, 38)];
    const steady = steadyLines(shown, next, false);
    expect(steady.map((l) => l.pv[0])).toEqual(['e2e4', 'd2d4']);
    expect(steady.map((l) => l.multipv)).toEqual([1, 2]);
  });
  it('switches when the new best lasts two updates or is clearly better', () => {
    const next = [line('d2d4', 1, 45), line('e2e4', 2, 38)];
    expect(steadyLines(shown, next, true)[0].pv[0]).toBe('d2d4');
    expect(steadyLines(shown, [line('d2d4', 1, 120), line('e2e4', 2, 40)], false)[0].pv[0]).toBe('d2d4');
  });
  it('switches when the shown move is no longer among the lines', () => {
    expect(steadyLines(shown, [line('g1f3', 1, 45), line('d2d4', 2, 40)], false)[0].pv[0]).toBe('g1f3');
  });
});
