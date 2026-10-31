import type { PageProblem } from '../shared/pageHealth';
import { findBoard, placementToFenBoard, readPlacement } from './boardDom';
import { readBoardState } from './boardReader';
import { classifyPath, hasGameResult, isLiveGamePath } from './pageScope';
import { SELECTORS, queryFirst } from './selectors';

const START_BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

/**
 * Check that what Vektra reads on a board page is still there. Pages
 * without a board, and games against people still in progress (Vektra is
 * off there anyway), have nothing to check.
 */
export function checkPage(pathname: string, doc: Document = document): PageProblem[] {
  const kind = classifyPath(pathname);
  if (kind === 'none' || (kind === 'archived' && !hasGameResult(doc))) return [];
  const board = findBoard(doc);
  if (!board) return ['board'];
  const problems: PageProblem[] = [];
  if (isLiveGamePath(pathname) && !queryFirst(doc, SELECTORS.botBoard)) problems.push('botBoard');
  const placement = readPlacement(board);
  if (placement.size === 0) return [...problems, 'pieces'];
  // A game that has moved on from the start must have moves to read. The
  // analysis board can start from any position, so it isn't checked.
  if (kind === 'game' || kind === 'archived') {
    const state = readBoardState(doc);
    if (!state || (state.sans.length === 0 && placementToFenBoard(placement) !== START_BOARD)) problems.push('moves');
  }
  return problems;
}
