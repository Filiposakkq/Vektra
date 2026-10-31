/**
 * What the popup asks the content script about the page: whether Vektra can
 * still find what it reads on chess.com. When chess.com changes its markup,
 * the hints stop silently; this lets the popup say why.
 */

export const PAGE_HEALTH = 'vektra:page-health';

/**
 * - board:    no board element found
 * - botBoard: a bot game whose board isn't the bot board Vektra checks for
 * - pieces:   a board without readable pieces
 * - moves:    the moves of a game can't be read
 */
export type PageProblem = 'board' | 'botBoard' | 'pieces' | 'moves';

export interface PageHealth {
  problems: PageProblem[];
}

const CHANGED = 'Chess.com may have changed its page; Vektra needs an update to read it again.';

const PROBLEM_TEXT: Record<PageProblem, string> = {
  board: `Vektra can't find the board on this page, so no hints will show. ${CHANGED}`,
  botBoard: `Vektra can't confirm this is a bot game, so hints stay off. ${CHANGED}`,
  pieces: `Vektra can't read the pieces on the board, so no hints will show. ${CHANGED}`,
  moves: `Vektra can't read the moves of this game, so hints may be wrong or missing. ${CHANGED}`,
};

/** Shown on a chess.com tab where the content script doesn't answer. */
export const NOT_RUNNING_TEXT = "Vektra isn't running in this tab yet. Reload the page to start it.";

/** The warning for the first problem found, or null when the page reads fine. */
export function pageHealthText(health: PageHealth): string | null {
  const first = health.problems[0];
  return first ? PROBLEM_TEXT[first] : null;
}
