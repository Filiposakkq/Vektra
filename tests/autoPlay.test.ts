import { describe, expect, it, vi } from 'vitest';
import { canAutoPlay, playUciMove } from '../src/content/autoPlay';
import type { BoardState } from '../src/content/boardReader';

const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function gameState(overrides: Partial<BoardState> = {}): BoardState {
  const board = document.createElement('wc-chess-board');
  board.innerHTML = '<div class="piece wp square-52"></div>';
  board.getBoundingClientRect = () => new DOMRect(10, 20, 800, 800);
  return {
    fen: startFen,
    ply: 0,
    source: 'replay',
    flipped: false,
    sans: [],
    inVariation: false,
    board,
    ...overrides,
  } as BoardState;
}

describe('autoplay safety', () => {
  it('only plays enabled, live main-line games on the user turn', () => {
    const state = gameState();
    expect(canAutoPlay(state, 'game', true)).toBe(true);
    expect(canAutoPlay(state, 'game', false)).toBe(false);
    expect(canAutoPlay(state, 'analysis', true)).toBe(false);
    expect(canAutoPlay(gameState({ source: 'dom' }), 'game', true)).toBe(false);
    expect(canAutoPlay(gameState({ inVariation: true }), 'game', true)).toBe(false);
    expect(canAutoPlay(gameState({ flipped: true }), 'game', true)).toBe(false);
    expect(canAutoPlay(gameState({ ply: 1 }), 'game', true)).toBe(false);
    expect(
      canAutoPlay(state, 'game', true, new DOMParser().parseFromString(
        '<div class="game-over-modal-shell-content"></div>',
        'text/html',
      )),
    ).toBe(false);
  });

  it('submits only legal non-promotion moves through square clicks', () => {
    const state = gameState();
    const events: Event[] = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      state.board.addEventListener(type, (event) => events.push(event));
    }

    expect(playUciMove(state, 'e2e4')).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click',
    ]);
    expect([(events[0] as PointerEvent).clientX, (events[0] as PointerEvent).clientY]).toEqual([460, 670]);
    expect([(events[2] as PointerEvent).clientX, (events[2] as PointerEvent).clientY]).toEqual([460, 470]);
    expect(playUciMove(state, 'e2e5')).toBe(false);
    expect(playUciMove(state, 'e7e8q')).toBe(false);
    expect(playUciMove(state, 'invalid')).toBe(false);
  });

  it('targets the piece on the destination square for captures', () => {
    const board = document.createElement('wc-chess-board');
    board.innerHTML = '<div class="piece wp square-54"></div><div class="piece bp square-45"></div>';
    board.getBoundingClientRect = () => new DOMRect(0, 0, 800, 800);
    const state = gameState({
      fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2',
      board,
      sans: ['e4', 'd5'],
      ply: 2,
    });
    const targets: EventTarget[] = [];
    board.addEventListener('click', (event) => targets.push(event.target!));

    expect(playUciMove(state, 'e4d5')).toBe(true);
    expect(targets[0]).toBe(board.querySelector('.piece.bp.square-45'));
  });

  it('does not send input if the source piece is not on the board', () => {
    const state = gameState();
    const dispatch = vi.spyOn(state.board, 'dispatchEvent');

    expect(playUciMove(state, 'd2d4')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
