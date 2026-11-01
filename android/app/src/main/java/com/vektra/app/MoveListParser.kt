package com.vektra.app

/**
 * The moves the Chess.com app shows under the board. Only the part of the list
 * on screen is readable ("3. c3 e5 4. f4"), so this gives the latest moves and
 * whose turn it is, not the whole game.
 */
data class VisibleMoves(
    /** Move numbers and moves as shown, e.g. ["3.", "c3", "e5", "4.", "f4"]. */
    val tokens: List<String>,
    /** 'w' or 'b', or null when the list shows no move number. */
    val sideToMove: Char?,
)

object MoveListParser {
    private val NUMBER = Regex("""^\d+\.(\.\.)?$""")
    /** SAN, with piece letters in either case: piece icons come through as lower-case letters ("qe2"). */
    private val MOVE = Regex("""^([KQRBNkqrbn]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBNqrbn])?|O-O(-O)?)[+#]?$""")
    /** Longer texts are messages (the bot's chat bubble), not moves. */
    private const val MAX_TEXT = 12

    fun parse(texts: List<String>): VisibleMoves {
        val tokens = texts
            .filter { it.trim().length <= MAX_TEXT }
            .flatMap { it.trim().split(Regex("""\s+""")) }
            .filter { NUMBER.matches(it) || MOVE.matches(it) }
        val lastNumber = tokens.indexOfLast { NUMBER.matches(it) }
        if (lastNumber < 0) return VisibleMoves(tokens, null)
        val after = tokens.size - lastNumber - 1
        // "4." then one move: White has moved, Black to play. "3..." starts with Black's move.
        val blackFirst = tokens[lastNumber].endsWith("...")
        val side = when {
            after == 0 -> if (blackFirst) 'b' else 'w'
            after == 1 -> if (blackFirst) 'w' else 'b'
            else -> 'w'
        }
        return VisibleMoves(tokens, side)
    }
}
