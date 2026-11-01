/**
 * Tunable constants for move classification and accuracy.
 *
 * All win values are win percentages (0-100) for the player who moved,
 * from the logistic curve in winProbability.ts. "Loss" is how much the
 * move dropped that player's win % compared with the engine's best move.
 */

export const CLASSIFICATION = {
  /**
   * Steepness of the centipawn -> win % curve (winProbability.ts) used for
   * ratings, accuracy, the eval graph and the eval bar. This is Lichess's
   * constant (0.00368208), unchanged; the calibration against chess.com's
   * Game Review is in ACCURACY below, not in this curve.
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
   * recaptures and minus anything the move captured, beyond what the best
   * other move would give up, for it to count as a sacrifice. 1 includes a
   * minor piece for two pawns and the exchange for a pawn, which chess.com
   * rates Brilliant too.
   */
  BRILLIANT_MIN_MATERIAL_LOSS: 1,

  /**
   * Great: the best move when the second-best move is clearly worse (the only
   * good move), and the game is not already won.
   */
  GREAT_MIN_GAP: 15,
  GREAT_MAX_WIN_BEFORE: 90,

  /**
   * Miss: after the opponent's Inaccuracy or worse, failing to take advantage
   * (loss above GOOD_MAX_LOSS) from a position at least this good, however
   * much it gives back: not taking a hung queen is a Miss on chess.com, not
   * a Blunder.
   */
  MISS_MIN_WIN_BEFORE: 60,
} as const;

/**
 * Per-move accuracy from win % loss: A * exp(-B * loss) - C, clamped to 0-100.
 * A and C are Lichess's; B is steeper than Lichess's 0.04354.
 *
 * A side's game accuracy (see summarize) is, like Lichess's, the average of
 * a weighted mean and a harmonic mean of its move accuracies. Each move is
 * weighted by how much the win % swung in the WINDOW positions up to it
 * (standard deviation, clamped to WEIGHT_MIN-WEIGHT_MAX): moves in a sharp
 * game count more. In the harmonic mean no move counts below HARMONIC_FLOOR,
 * so one or two moves that throw the game away pull the score down without
 * sinking it to nothing.
 *
 * B and HARMONIC_FLOOR were fitted at depth 12 to chess.com's Game Review of
 * three of filip's games (six accuracies, average error 2 points).
 */
export const ACCURACY = {
  A: 103.1668,
  B: 0.075,
  C: 3.1669,
  HARMONIC_FLOOR: 20,
  WINDOW_MIN: 2,
  WINDOW_MAX: 8,
  WEIGHT_MIN: 0.5,
  WEIGHT_MAX: 12,
} as const;

/**
 * Game rating: a line through chess.com's Game Rating of one reviewed game
 * (accuracy 97.5 rated 2650, 80.4 rated 1950), about 41 rating points per
 * accuracy point, rounded to 50 and kept within MIN-MAX. A rough guide only
 * until more games are calibrated (docs/CALIBRATION.md).
 */
export const GAME_RATING = { AT_ACCURACY: 80.4, BASE: 1950, PER_POINT: 40.94, MIN: 100, MAX: 3200 } as const;

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
