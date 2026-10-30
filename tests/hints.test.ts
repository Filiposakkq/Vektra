import { describe, expect, it } from 'vitest';
import {
  arrowsFromLines,
  buildRequest,
  chooseWeakerMove,
  isStrengthLimited,
  shouldHint,
  userMoveToRate,
  weakerMoveCandidates,
  weakerPickArrow,
  weakenedArrows,
} from '../src/content/hints';
import { fenAfter as fenAfterMoves } from './fixtures/dom';
import type { BoardState } from '../src/content/boardReader';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { arrowGeometry, BoardOverlay, squareCenter, WEAKER_ARROW_COLOR } from '../src/ui/overlay';

const state = (fen: string, flipped: boolean) => ({ fen, flipped }) as BoardState;
const WHITE_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

describe('hint rules', () => {
  it('live games: only on the user turn (user plays from the bottom)', () => {
    expect(shouldHint(state(WHITE_TO_MOVE, false), 'game')).toBe(true);
    expect(shouldHint(state(BLACK_TO_MOVE, false), 'game')).toBe(false);
    expect(shouldHint(state(BLACK_TO_MOVE, true), 'game')).toBe(true);
    expect(shouldHint(state(WHITE_TO_MOVE, true), 'game')).toBe(false);
  });

  it('analysis and review: both sides', () => {
    expect(shouldHint(state(BLACK_TO_MOVE, false), 'analysis')).toBe(true);
    expect(shouldHint(state(WHITE_TO_MOVE, true), 'review')).toBe(true);
  });

  it('builds engine requests from settings', () => {
    expect(buildRequest('fen', DEFAULT_SETTINGS)).toEqual({
      fen: 'fen',
      multipv: 3,
      limit: { depth: 16 },
      strength: { skillLevel: 20, limitStrength: false, elo: 2000 },
    });
    expect(buildRequest('fen', { ...DEFAULT_SETTINGS, searchMode: 'movetime', movetimeMs: 800 }).limit).toEqual({
      movetimeMs: 800,
    });
    expect(isStrengthLimited(DEFAULT_SETTINGS)).toBe(false);
    expect(isStrengthLimited({ ...DEFAULT_SETTINGS, skillLevel: 5 })).toBe(true);
  });

  it('requests enough engine lines when occasional weaker moves are enabled', () => {
    expect(buildRequest('fen', { ...DEFAULT_SETTINGS, arrows: 1 }).multipv).toBe(1);
    expect(buildRequest('fen', { ...DEFAULT_SETTINGS, arrows: 1, occasionalWeakerMoves: true }).multipv).toBe(5);
    expect(buildRequest('fen', { ...DEFAULT_SETTINGS, arrows: 1, weakenedShowsTopMoves: true }).multipv).toBe(5);
  });

  it('chooses only legal alternatives within the configured evaluation-loss limit', () => {
    const fen = WHITE_TO_MOVE;
    const line = (move: string, value: number, depth = 16) => ({
      multipv: 1,
      depth,
      score: { type: 'cp' as const, value },
      pv: [move],
    });
    const settings = {
      ...DEFAULT_SETTINGS,
      occasionalWeakerMoves: true,
      weakerMoveChancePercent: 50,
      weakerMoveMaxLossCp: 100,
    };
    const lines = [
      line('e2e4', 60),
      line('d2d4', 0),
      line('g1f3', -250),
      line('e2e5', 30),
      line('b1c3', 40, 15),
    ];

    expect(chooseWeakerMove(fen, 'e2e4', lines, settings, () => 0)).toEqual({
      move: 'd2d4',
      lossCp: 60,
    });
    expect(weakerMoveCandidates(fen, 'e2e4', lines, {
      ...settings,
      weakerMoveChancePercent: 0,
    })).toEqual([{ move: 'd2d4', lossCp: 60 }]);
    expect(chooseWeakerMove(fen, 'e2e4', lines, settings, () => 0.5)).toBeNull();
    expect(
      chooseWeakerMove(fen, 'e2e4', lines, { ...settings, weakerMoveMaxLossCp: 50 }, () => 0),
    ).toBeNull();
    expect(
      chooseWeakerMove(fen, 'a2a3', lines, settings, () => 0),
    ).toMatchObject({ move: 'd2d4', lossCp: 60 });
    expect(chooseWeakerMove(fen, 'a2a3', lines, settings, () => 0)).toMatchObject({
      move: 'd2d4',
      lossCp: 60,
    });

    expect(chooseWeakerMove(fen, 'e2e4', lines, { ...settings, occasionalWeakerMoves: false }, () => 0)).toBeNull();
  });

  it('chooses the weaker preview relative to the selected engine move', () => {
    const lines = [
      { multipv: 1, depth: 16, score: { type: 'cp' as const, value: 100 }, pv: ['e2e4'] },
      { multipv: 2, depth: 16, score: { type: 'cp' as const, value: 80 }, pv: ['d2d4'] },
      { multipv: 3, depth: 16, score: { type: 'cp' as const, value: 50 }, pv: ['g1f3'] },
    ];
    expect(weakerMoveCandidates(WHITE_TO_MOVE, 'd2d4', lines, {
      ...DEFAULT_SETTINGS,
      occasionalWeakerMoves: true,
      weakerMoveChancePercent: 0,
    })).toEqual([{ move: 'g1f3', lossCp: 30 }]);
  });

  it('ranks arrows by multipv order and respects the count', () => {
    const line = (m: string, multipv: number) => ({ multipv, depth: 10, score: { type: 'cp' as const, value: 0 }, pv: [m] });
    expect(arrowsFromLines([line('e2e4', 1), line('d2d4', 2), line('g1f3', 3)], 2)).toEqual([
      { move: 'e2e4', rank: 0 },
      { move: 'd2d4', rank: 1 },
    ]);
  });

  it('shows only the selected weaker move instead of normal MultiPV arrows', () => {
    expect([weakerPickArrow('d2d4')]).toEqual([{ move: 'd2d4', rank: 0, weaker: true }]);
  });

  it('shows additional best lines beside the reduced-strength suggestion', () => {
    expect(
      weakenedArrows('d2d4', [
        { multipv: 1, depth: 10, score: { type: 'cp', value: 30 }, pv: ['e2e4'] },
        { multipv: 2, depth: 10, score: { type: 'cp', value: 20 }, pv: ['d2d4'] },
        { multipv: 3, depth: 10, score: { type: 'cp', value: 10 }, pv: ['g1f3'] },
      ], 3),
    ).toEqual([
      { move: 'd2d4', rank: 0 },
      { move: 'e2e4', rank: 1 },
      { move: 'g1f3', rank: 2 },
    ]);
  });
});

describe('overlay geometry', () => {
  it('maps squares to screen positions, including flipped boards', () => {
    expect(squareCenter('a1', false)).toEqual([0.5, 7.5]);
    expect(squareCenter('h8', false)).toEqual([7.5, 0.5]);
    expect(squareCenter('a1', true)).toEqual([7.5, 0.5]);
    expect(squareCenter('e2', true)).toEqual([3.5, 1.5]);
  });

  it('draws an arrow whose tip is the target square centre', () => {
    const { shaft, head } = arrowGeometry([4.5, 6.5], [4.5, 4.5], 0.2);
    expect(head.split(' ')[0]).toBe('4.500,4.500');
    // Starts off the piece and ends inside the head.
    expect(shaft).toMatch(/^M4\.500,6\.220 L4\.500,4\.8/);
  });

  it('bends a knight arrow at its corner', () => {
    const { shaft } = arrowGeometry([6.5, 7.5], [5.5, 5.5], 0.2, [6.5, 5.5]);
    expect(shaft.split(' ')).toHaveLength(3);
    expect(shaft).toContain('L6.500,5.500');
  });

  it('highlights the primary move squares and draws a dashed connector', () => {
    const board = document.createElement('wc-chess-board');
    document.body.append(board);
    const overlay = new BoardOverlay(board);

    overlay.draw(board, [{ move: 'e2e4', rank: 0 }, { move: 'd2d4', rank: 1 }], false);

    expect(
      [...board.querySelectorAll('.vektra-square-highlight')].map((square) => square.getAttribute('data-square')),
    ).toEqual(['e2', 'e4']);
    const line = board.querySelector<SVGPathElement>('.vektra-move[data-move="e2e4"] .vektra-arrow-line');
    expect(line?.getAttribute('stroke-dasharray')).toBe('0.07 0.09');
    expect(board.querySelectorAll('.vektra-square-highlight')).toHaveLength(2);
    overlay.destroy();
    board.remove();
  });

  it('uses a distinct color for a selected weaker alternative', () => {
    const board = document.createElement('wc-chess-board');
    document.body.append(board);
    const overlay = new BoardOverlay(board);
    overlay.colors = ['#111111', '#222222', '#333333'];

    overlay.draw(
      board,
      [
        { move: 'd2d4', rank: 0, weaker: true },
        { move: 'e2e4', rank: 1 },
      ],
      false,
    );

    const weaker = board.querySelector<SVGGElement>('.vektra-move[data-move="d2d4"]');
    const normal = board.querySelector<SVGPathElement>('.vektra-move[data-move="e2e4"] .vektra-arrow-line');
    expect(weaker?.dataset.weaker).toBe('true');
    expect(Number(weaker?.getAttribute('opacity'))).toBeLessThan(0.92);
    expect(weaker?.querySelector('.vektra-arrow-line')?.getAttribute('stroke')).toBe(WEAKER_ARROW_COLOR);
    expect(weaker?.querySelector('.vektra-square-highlight')?.getAttribute('fill')).toBe(WEAKER_ARROW_COLOR);
    expect(normal?.getAttribute('stroke')).toBe('#222222');
    overlay.destroy();
    board.remove();
  });
});

describe('engine strength and search limits', () => {
  it('keeps Elo strength independent of the configured depth and time', () => {
    const elo1500 = { ...DEFAULT_SETTINGS, limitStrength: true, elo: 1500 };
    expect(buildRequest('fen', { ...elo1500, depth: 12 }).limit).toEqual({ depth: 12 });
    expect(
      buildRequest('fen', { ...elo1500, searchMode: 'movetime', movetimeMs: 3000 }).limit,
    ).toEqual({ movetimeMs: 3000 });
    expect(
      buildRequest('fen', { ...DEFAULT_SETTINGS, skillLevel: 5, depth: 9 }).limit,
    ).toEqual({ depth: 9 });
  });
});

describe('live move ratings', () => {
  const st = (sans: string[], flipped: boolean) =>
    ({ sans, ply: sans.length, fen: fenAfterMoves(sans), flipped, inVariation: false, source: 'replay' }) as BoardState;

  it("rates the user's own moves only", async () => {
    await expect(userMoveToRate(st(['e4'], false))).resolves.toMatchObject({ ply: 1, san: 'e4', uci: 'e2e4', book: true });
    await expect(userMoveToRate(st(['e4', 'e5'], false))).resolves.toBeNull(); // the bot's move
    await expect(userMoveToRate(st(['e4', 'e5'], true))).resolves.toMatchObject({ san: 'e5', uci: 'e7e5' });
    await expect(userMoveToRate(st([], false))).resolves.toBeNull();
  });

  it('knows when the game has left the book', async () => {
    await expect(userMoveToRate(st(['e4', 'e5', 'Ke2', 'Ke7', 'Kd3'], false))).resolves.toMatchObject({ book: false });
  });
});
