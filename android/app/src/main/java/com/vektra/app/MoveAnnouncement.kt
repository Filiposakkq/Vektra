package com.vektra.app

import java.util.Locale

/**
 * A move as Chess.com announces it for screen readers, the moment it is
 * played. It arrives a few hundred milliseconds before the board can be read,
 * so Vektra applies it to the position it knows and checks it against the
 * board afterwards. Wordings seen in the Czech app:
 *
 * - a move:    "Bílý Dáma z d1 na d4" (White Queen from d1 to d4)
 * - a capture: "Věž d5 bere věž na d1" (Rook d5 takes rook on d1), no colour
 * - a king's capture: "Král bere dámu na e2", no colour and no from-square
 * - castling: no square at all ("rošáda" is assumed, not yet seen on the phone)
 *
 * So this only takes what any wording has: the mover's piece, its colour when
 * named (otherwise it is the side to move), and the squares mentioned. The
 * overlay page picks the one legal move that fits.
 */
data class MoveAnnouncement(val squares: List<String>, val color: Char?, val piece: Char) {
    companion object {
        private val SQUARE = Regex("""\b([a-h][1-8])\b""")
        // Words only: the move list's "O-O" is text too, and would be taken for a new move.
        private val CASTLING = Regex("""rošád|castl""", RegexOption.IGNORE_CASE)
        private val LONG_CASTLING = Regex("""velk|dlouh|queen|long""", RegexOption.IGNORE_CASE)

        /** The move in an announcement, or null if the text isn't one. */
        fun parse(text: String): MoveAnnouncement? {
            val words = text.lowercase(Locale.ROOT).split(' ', ',', '.', ':', '-').filter { it.isNotEmpty() }
            val squares = SQUARE.findAll(text).map { it.value }.toList()
            // Castling names no square: the king's two squares for either side,
            // and only the side to move can castle that way.
            if (squares.isEmpty() && CASTLING.containsMatchIn(text)) {
                val king = if (LONG_CASTLING.containsMatchIn(text)) listOf("e1", "c1", "e8", "c8") else listOf("e1", "g1", "e8", "g8")
                return MoveAnnouncement(king, words.firstNotNullOfOrNull { PieceNames.COLORS[it] }, 'k')
            }
            if (squares.isEmpty() || squares.size > 3) return null
            // The first piece named is the mover's ("Rook d5 takes rook on d1"),
            // after its colour if there is one.
            val pieceAt = words.indexOfFirst { it in PieceNames.PIECES }
            if (pieceAt < 0) return null
            val color = words.take(pieceAt).firstNotNullOfOrNull { PieceNames.COLORS[it] }
            // Without a colour, the piece must lead, with two squares or more
            // words: a bare "Věž na h1" is a square's label, not a move.
            if (color == null && (pieceAt != 0 || (squares.size < 2 && words.size <= 3))) return null
            return MoveAnnouncement(squares, color, PieceNames.PIECES.getValue(words[pieceAt]))
        }
    }
}
