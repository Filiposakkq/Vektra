/**
 * Tunable constants for move classification and accuracy.
 *
 * All win values are win percentages (0-100) for the player who moved,
 * from the logistic curve in winProbability.ts. "Loss" is how much the
 * move dropped that player's win % compared with the engine's best move.
 */

export const CLASSIFICATION = {
  /**
   * Steepness of the centipawn -> win % curve used for ratings and accuracy.
   * Lichess uses 0.00368; chess.com's review is gentler (a lead counts for
   * less), so losses in clearly won or lost positions still show up.
   * Calibrated on real games against chess.com's Game Review.
   */
  WIN_PROB_K: 0.00368208,
  /**
   * A forced mate is worth less the further away it is: mate in N counts as
   * 100 - MATE_STEP * (N - 1) win %, down to MATE_FLOOR. Without this, letting
   * a mate in 3 slip into a mate in 11 costs nothing, while chess.com calls it
   * a Miss.
   */
  MATE_STEP: 2,
  MATE_FLOOR: 80,
  /**
   * Best is the engine's top move, or another of its lines scored within this
   * many centipawns of it (an equally good alternative). Other moves are at
   * most Excellent, even in a won position where the win % hardly changes.
   */
  BEST_MAX_CP_LOSS: 5,
  EXCELLENT_MAX_LOSS: 2,
  GOOD_MAX_LOSS: 5,
  INACCURACY_MAX_LOSS: 10,
  MISTAKE_MAX_LOSS: 20,
  // Anything above MISTAKE_MAX_LOSS is a Blunder (unless it is a Miss).

  /**
   * Brilliant: a sacrifice that is the best or near-best move, played when the
   * game is not already decided.
   */
  BRILLIANT_MAX_LOSS: 1,
  BRILLIANT_MIN_WIN_BEFORE: 20,
  /** Not when the game was already completely decided. */
  BRILLIANT_MAX_WIN_BEFORE: 98,
  BRILLIANT_MIN_WIN_AFTER: 50,
  /** Smallest piece value (pawns = 1) that counts as sacrificed. */
  BRILLIANT_MIN_PIECE_VALUE: 3,
  /**
   * Net material (pawns) the opponent must be able to win, after all
   * recaptures and minus anything the move captured, for it to count as a
   * sacrifice. 2 includes exchange sacrifices (rook for minor piece).
   */
  BRILLIANT_MIN_MATERIAL_LOSS: 2,

  /**
   * Great: the best move when the second-best move is clearly worse (the only
   * good move), and the game is not already won.
   */
  GREAT_MIN_GAP: 15,
  GREAT_MAX_WIN_BEFORE: 90,

  /**
   * Miss: after the opponent's Mistake or Blunder, failing to take advantage
   * (loss above GOOD_MAX_LOSS) while still keeping a playable position.
   */
  MISS_MIN_WIN_BEFORE: 60,
  MISS_MIN_WIN_AFTER: 40,
} as const;

/**
 * Per-move accuracy from win % loss: A * exp(-B * loss) - C, clamped to 0-100.
 * A and C are Lichess's; B is steeper than Lichess's 0.04354 so that a game
 * score (the harmonic mean, see summarize) lands close to chess.com's
 * accuracy. Calibrated on filip's games against chess.com's Game Review.
 */
export const ACCURACY = { A: 103.1668, B: 0.08, C: 3.1669 } as const;

/** Book moves: only within the first this many plies, and only while every earlier move was book. */
export const BOOK_MAX_PLY = 30;

/** Default engine depth for full-game analysis (configurable in the popup). */
export const DEFAULT_ANALYSIS_DEPTH = 12;

/**
 * Longest full-game analysis searches one position, in ms. The search
 * normally reaches the analysis depth first; this keeps one sharp position
 * from stalling the whole game at high depths.
 */
export const ANALYSIS_MAX_MOVETIME_MS = 15000;

/** Engine lines per position in full-game analysis (Great needs the second best). */
export const ANALYSIS_MULTIPV = 2;

/** Transposition-table size for full-game analysis searches, in MiB. */
export const ANALYSIS_HASH_MB = 64;

/** Version of the lite Stockfish build shipped with the extension (the stockfish package in package-lock.json). */
export const LITE_ENGINE_VERSION = '19.0.1';
