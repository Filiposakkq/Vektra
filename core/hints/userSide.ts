import type { GameView } from './types';
import type { PageKind } from './types';

/**
 * In live games, hints only show on the user's turn. The user plays from the
 * bottom of the board, so a flipped board means the user has Black.
 */
export function shouldHint(state: GameView, kind: PageKind): boolean {
  if (kind !== 'game') return true;
  const userColor = state.flipped ? 'b' : 'w';
  return state.fen.split(' ')[1] === userColor;
}
