import { SELECTORS, queryFirst } from './selectors';

/**
 * Where Vektra is allowed to run.
 *
 * This build is limited to games against chess.com's bots. Hints, live
 * ratings and autoplay run only in bot games; games against people are
 * enabled only once they have finished, for review. Anything that can't be
 * confirmed as one of those stays inactive.
 *
 *  - game:      a game against the computer
 *  - analysis:  analysis board (/analysis)
 *  - review:    game review (/game/review)
 *  - archived:  a finished game against a person (review behavior)
 *  - none:      not a board page
 */
export type PageKind = 'game' | 'analysis' | 'review' | 'archived' | 'none';

export type Scope =
  | { status: 'enabled'; kind: PageKind }
  | { status: 'inactive'; kind: PageKind };

const PLAY_COMPUTER = /^\/play\/computer(\/|$)/;
/** A game against a bot, opened from the archive or after it ended. */
const SAVED_COMPUTER_GAME = /^\/game\/computer\/[^/]+/;

export function classifyPath(pathname: string): PageKind {
  const p = pathname.toLowerCase().replace(/\/+$/, '');
  if (PLAY_COMPUTER.test(p) || SAVED_COMPUTER_GAME.test(p)) return 'game';
  if (/^\/analysis(\/|$)/.test(p)) return 'analysis';
  if (/^\/game\/review(\/|$)/.test(p)) return 'review';
  // Games against people, in progress or finished.
  if (/^\/play\/online(\/|$)/.test(p)) return 'archived';
  if (/^\/(live|daily|game|variants|game-[^/]+)(\/|$)/.test(p)) return 'archived';
  return 'none';
}

/** True when the page shows clear signs that the game has finished. */
export function isGameOver(doc: ParentNode): boolean {
  if (queryFirst(doc, SELECTORS.gameOverSignals)) return true;
  return hasGameResult(doc);
}

/** True when the move list ends with a result, the most reliable game-over signal. */
export function hasGameResult(doc: ParentNode): boolean {
  const result = queryFirst(doc, SELECTORS.resultText);
  return !!result && /^(1-0|0-1|1\/2-1\/2|½-½)$/.test((result.textContent ?? '').trim());
}

/**
 * Enable bot games, analysis and review. A game against a person is enabled
 * for review only once its move list shows a result; until then, and whenever
 * that can't be read, it stays inactive.
 */
export function resolveScope(pathname: string, doc: ParentNode): Scope {
  const kind = classifyPath(pathname);
  switch (kind) {
    case 'game':
      // The bot board is a second check, in case the page moves on to another
      // game before its URL changes.
      return PLAY_COMPUTER.test(pathname.toLowerCase()) && !queryFirst(doc, SELECTORS.botBoard)
        ? { status: 'inactive', kind }
        : { status: 'enabled', kind };
    case 'analysis':
    case 'review':
      return { status: 'enabled', kind };
    case 'archived':
      return hasGameResult(doc) ? { status: 'enabled', kind } : { status: 'inactive', kind };
    default:
      return { status: 'inactive', kind };
  }
}

/** Whether the current bot game URL can represent a game in progress. */
export function isLiveGamePath(pathname: string): boolean {
  return PLAY_COMPUTER.test(pathname.toLowerCase().replace(/\/+$/, ''));
}
