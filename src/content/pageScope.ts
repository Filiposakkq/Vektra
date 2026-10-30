import { SELECTORS, queryFirst } from './selectors';

/**
 * Where Vektra is allowed to run.
 *
 *  - game:      games against a person or the computer
 *  - analysis:  analysis board (/analysis)
 *  - review:    game review (/game/review)
 *  - archived:  a finished /game/live or /game/daily page (review behavior)
 *  - none:      not a board page
 */
export type PageKind = 'game' | 'analysis' | 'review' | 'archived' | 'none';

export type Scope =
  | { status: 'enabled'; kind: PageKind }
  | { status: 'inactive'; kind: PageKind };

export function classifyPath(pathname: string): PageKind {
  const p = pathname.toLowerCase().replace(/\/+$/, '');
  if (/^\/play\/(computer|online)(\/|$)/.test(p)) return 'game';
  // A game against a bot, opened from the archive or after it ended.
  if (/^\/game\/computer\/[^/]+/.test(p)) return 'game';
  if (/^\/analysis(\/|$)/.test(p)) return 'analysis';
  if (/^\/game\/review(\/|$)/.test(p)) return 'review';
  if (/^\/game\/(live|daily)\/[^/]+/.test(p)) return 'archived';
  if (/^\/(live|daily|game|variants|game-[^/]+)(\/|$)/.test(p)) return 'game';
  return 'none';
}

/** True when the page shows clear signs that the game has finished. */
export function isGameOver(doc: ParentNode): boolean {
  if (queryFirst(doc, SELECTORS.gameOverSignals)) return true;
  const result = queryFirst(doc, SELECTORS.resultText);
  return !!result && /^(1-0|0-1|1\/2-1\/2|½-½)$/.test((result.textContent ?? '').trim());
}

/**
 * Enable live games immediately; keep finished game pages in review behavior.
 */
export function resolveScope(pathname: string, doc: ParentNode): Scope {
  const kind = classifyPath(pathname);
  switch (kind) {
    case 'game':
    case 'analysis':
    case 'review':
      return { status: 'enabled', kind };
    case 'archived':
      return isGameOver(doc)
        ? { status: 'enabled', kind }
        : { status: 'enabled', kind: 'game' };
    default:
      return { status: 'inactive', kind };
  }
}

/** Whether the current game URL can represent a game in progress. */
export function isLiveGamePath(pathname: string): boolean {
  const p = pathname.toLowerCase().replace(/\/+$/, '');
  if (/^\/game\/computer\/[^/]+/.test(p)) return false;
  return /^\/play\/(computer|online)(\/|$)/.test(p) ||
    /^\/(live|daily|game|variants|game-[^/]+)(\/|$)/.test(p);
}
