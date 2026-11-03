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
 *
 * So this only takes what any wording has: the mover's piece, its colour when
 * named (otherwise it is the side to move), and the squares mentioned. The
 * overlay page picks the one legal move that fits.
 */
data class MoveAnnouncement(val squares: List<String>, val color: Char?, val piece: Char) {
    companion object {
        private val SQUARE = Regex("""\b([a-h][1-8])\b""")

        /** The move in an announcement, or null if the text isn't one. */
        fun parse(text: String): MoveAnnouncement? {
            val squares = SQUARE.findAll(text).map { it.value }.toList()
            if (squares.isEmpty() || squares.size > 3) return null
            val words = text.lowercase(Locale.ROOT).split(' ', ',', '.', ':', '-').filter { it.isNotEmpty() }
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
