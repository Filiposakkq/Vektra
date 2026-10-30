/**
 * Every chess.com DOM selector Vektra depends on lives in this file.
 *
 * chess.com changes its markup from time to time. When the extension stops
 * reading the board, update the lists below (see README "Updating selectors").
 * Each entry is a list tried in order; the first match wins, so put the
 * current markup first and keep older variants as fallbacks.
 *
 * Status of each selector is noted as CONFIRMED (seen in markup captured from
 * chess.com on 2026-10-29, see tests/fixtures/chesscom) or UNCONFIRMED.
 */

export const SELECTORS = {
  /**
   * The board element. Pieces are its descendants. Its id differs per page:
   * board-analysis-board, board-single (/game/live), board-play-computer. CONFIRMED
   */
  board: ['wc-chess-board', '#board-single', '#board-play-computer', '#board-analysis-board'],

  /** Class on the board element when it is shown from Black's side. CONFIRMED */
  boardFlippedClass: 'flipped',

  /**
   * Piece elements, e.g. <div class="piece wp square-52">.
   * Colour+type is a class like "wp" / "bk"; square is "square-<file><rank>"
   * with file and rank both 1-8 (a1 = square-11, e2 = square-52). Class order
   * varies ("piece square-67 bp"), so classes are matched individually. Square
   * classes stay absolute when the board is flipped. CONFIRMED
   */
  piece: '.piece',
  /** A piece being dragged has this class; it is ignored while reading. UNCONFIRMED */
  pieceDraggingClass: 'dragging',

  /**
   * Move list container. The tag differs per page (wc-move-list,
   * wc-simple-move-list) but the classes are shared. It carries a board-id
   * attribute naming its board, which is preferred when present. CONFIRMED
   */
  moveList: ['.move-list.chessboard-pkg-move-list-component', 'wc-move-list', 'wc-simple-move-list'],
  moveListBoardIdAttr: 'board-id',

  /**
   * Main-line plies, <div data-node="0-4" class="node white-move main-line-ply">.
   * Variation plies lack main-line-ply. CONFIRMED
   */
  mainLinePly: ['.node.main-line-ply'],
  /** Any ply node, main line or variation. CONFIRMED */
  anyPly: '.node[data-node]',
  /** data-node="<line>-<index>"; line 0 is the main line. CONFIRMED */
  plyNodeAttr: 'data-node',
  /** A variation's moves, and the move number it starts at ("3..."). CONFIRMED */
  variationLine: '.variation-line',
  variationStartNumber: '.move-number.start',

  /** Classes telling whose move a node is. CONFIRMED */
  whiteMoveClass: 'white-move',
  blackMoveClass: 'black-move',

  /**
   * Marks the ply shown on the board. chess.com puts it on the inner
   * span.node-highlight-content, not on the .node. With a fresh PGN on the
   * analysis board nothing is selected (start position). CONFIRMED
   */
  selectedPly: '.node-highlight-content.selected',

  /** Inside a ply: the element holding the SAN text (with a trailing space). CONFIRMED */
  plyText: ['.node-highlight-content'],

  /**
   * Piece figurines rendered as icons instead of letters, e.g.
   * <span class="icon-font-chess knight-white" data-figurine="N"></span>f3.
   * Taken from chess.com's JS bundle; not yet seen in a live page. UNCONFIRMED
   */
  figurine: '[data-figurine]',
  figurineAttr: 'data-figurine',

  /** chess.com's right-hand panel next to the board; the analysis panel docks here. CONFIRMED */
  sidebar: '#board-layout-sidebar',

  /**
   * Result at the end of the move list (1-0, 0-1, 1/2-1/2). Only present once
   * the game has ended; the most reliable game-over signal. CONFIRMED
   */
  resultText: ['.result-row .game-result', '.game-result'],

  /**
   * The game-over modal. A second signal; its whiteWon/blackWon header class
   * is not reliable, so only its presence is used. CONFIRMED
   */
  gameOverSignals: ['.game-over-modal-shell-content'],
} as const;

export function queryFirst<T extends Element = Element>(
  root: ParentNode,
  selectors: readonly string[],
): T | null {
  for (const sel of selectors) {
    const el = root.querySelector<T>(sel);
    if (el) return el;
  }
  return null;
}

export function queryAllFirst<T extends Element = Element>(
  root: ParentNode,
  selectors: readonly string[],
): T[] {
  for (const sel of selectors) {
    const els = root.querySelectorAll<T>(sel);
    if (els.length) return Array.from(els);
  }
  return [];
}
