/*
 * What the hint logic works on, the same on every platform: the game shown,
 * the kind of page or screen it is on, and the arrows it asks to draw.
 */

/**
 * Where a board is shown:
 *  - game:      a game against the computer
 *  - analysis:  an analysis board
 *  - review:    a game review
 *  - archived:  a finished game against a person (review behaviour)
 *  - none:      not a board
 */
export type PageKind = 'game' | 'analysis' | 'review' | 'archived' | 'none';

/** The game on the board, as read from the page or app. */
export interface GameView {
  fen: string;
  /** Plies played from the start to reach this position (0 = start). */
  ply: number;
  /**
   * replay: the FEN comes from the move list, so castling, en passant and
   *         move counters are exact.
   * dom:    the move list was unavailable or inconsistent; the FEN was rebuilt
   *         from the pieces and the extra fields are best guesses.
   */
  source: 'replay' | 'dom';
  /** Shown from Black's side. */
  flipped: boolean;
  /** Main-line moves in SAN. */
  sans: string[];
  /** True when the position shown is inside a variation, not the main line. */
  inVariation: boolean;
}

export interface Arrow {
  /** UCI move, e.g. "e2e4" or "e7e8q". */
  move: string;
  /** 0 = best. */
  rank: number;
  /** Deliberately weaker alternative selected for this position. */
  weaker?: boolean;
  /** Drawn while the search is still running; the move may still change. */
  provisional?: boolean;
  /** Score printed at the arrow's target square, e.g. "+0.8" or "M3". */
  label?: string;
  /**
   * How much worse than the best move this alternative is, in win-chance
   * points (0-100). Worse alternatives are drawn fainter.
   */
  winLoss?: number;
  /** The win-chance loss at which this arrow is at its faintest. */
  fadeFullAt?: number;
  /** Position in one line of play (1 = the move now), drawn numbered in one colour. */
  step?: number;
  /** What the opponent would play if it were their move. */
  threat?: boolean;
}
