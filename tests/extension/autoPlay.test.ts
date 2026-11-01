import { describe, expect, it, vi } from 'vitest';
import { canAutoPlay, choosePromotion, playUciMove } from '@ext/content/autoPlay';
import type { BoardState } from '@ext/content/boardReader';
import { DEFAULT_SETTINGS } from '@core/settings';

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

  it('submits only legal moves through square clicks', () => {
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

describe('promotions', () => {
  const PROMOTION_FEN = '8/4P3/8/8/8/8/k7/4K3 w - - 0 1';
  const promotionState = () => {
    const board = document.createElement('wc-chess-board');
    board.innerHTML = '<div class="piece wp square-57"></div>';
    board.getBoundingClientRect = () => new DOMRect(0, 0, 800, 800);
    return { ...gameState(), fen: PROMOTION_FEN, board } as BoardState;
  };

  it('moves the pawn for a legal promotion and refuses an illegal one', () => {
    const state = promotionState();
    const pressed: string[] = [];
    state.board.addEventListener('pointerdown', () => pressed.push('down'));
    expect(playUciMove(state, 'e7e8n')).toBe(true);
    expect(pressed).toEqual(['down']);
    expect(playUciMove(state, 'e7e8k')).toBe(false);
  });

  it('clicks the chosen piece in the promotion picker', async () => {
    document.body.innerHTML =
      '<div class="promotion-window"><div class="promotion-piece wq"></div><div class="promotion-piece wn"></div></div>';
    const knight = document.querySelector<HTMLElement>('.promotion-piece.wn')!;
    const queen = document.querySelector<HTMLElement>('.promotion-piece.wq')!;
    const onKnight = vi.fn();
    const onQueen = vi.fn();
    knight.addEventListener('click', onKnight);
    queen.addEventListener('click', onQueen);
    await expect(choosePromotion('n', 'w', document, 200)).resolves.toBe(true);
    expect(onKnight).toHaveBeenCalledOnce();
    expect(onQueen).not.toHaveBeenCalled();
  });

  it('waits for the picker to appear', async () => {
    document.body.innerHTML = '';
    setTimeout(() => {
      document.body.innerHTML = '<div class="promotion-window"><div class="promotion-piece bq"></div></div>';
    }, 60);
    await expect(choosePromotion('q', 'b', document, 1000)).resolves.toBe(true);
  });

  it('gives up when no picker appears', async () => {
    document.body.innerHTML = '';
    await expect(choosePromotion('r', 'w', document, 120)).resolves.toBe(false);
  });
});

describe('autoplay plans', () => {
  it('plays the newest choice for a position, keeping the delay already running', async () => {
    vi.useFakeTimers();
    try {
      const { AutoPlayScheduler } = await import('@ext/content/autoPlay');
      const state = gameState();
      state.board.innerHTML = '<div class="piece wp square-52"></div><div class="piece wp square-42"></div>';
      const pressed: string[] = [];
      state.board.addEventListener('pointerdown', (e) => pressed.push((e.target as HTMLElement).className));
      const delays: (number | null)[] = [];
      const plans: string[] = [];
      const scheduler = new AutoPlayScheduler(
        () => ({ ...DEFAULT_SETTINGS, autoPlay: true, autoPlayMinDelaySec: 1, autoPlayMaxDelaySec: 1 }),
        () => ({ status: 'enabled', kind: 'game' }),
        () => state,
        (ms) => delays.push(ms),
        (move) => plans.push(move),
      );
      scheduler.schedule(state, 'e2e4');
      vi.advanceTimersByTime(500);
      // The hints were worked out again and now show d2-d4.
      scheduler.schedule(state, 'd2d4');
      expect(plans).toEqual(['e2e4', 'd2d4']);
      expect(delays).toEqual([1000]);
      vi.advanceTimersByTime(600);
      expect(pressed).toEqual(['piece wp square-42']);
      // Playing the move doesn't blank the delay; only cancelling does.
      scheduler.clear();
      expect(delays).toEqual([1000]);
    } finally {
      vi.useRealTimers();
    }
  });
});
