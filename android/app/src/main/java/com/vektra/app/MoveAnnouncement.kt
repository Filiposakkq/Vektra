package com.vektra.app

import java.util.Locale

/**
 * A move as Chess.com announces it for screen readers, the moment it is
 * played: "Bílý Dáma z d1 na d4" (White Queen from d1 to d4). It arrives a
 * few hundred milliseconds before the board can be read, so Vektra applies
 * it to the position it knows and checks it against the board afterwards.
 */
data class MoveAnnouncement(val from: String, val to: String, val color: Char) {
    companion object {
        private val SQUARE = Regex("""\b([a-h][1-8])\b""")

        /** The move in an announcement, or null if the text isn't one. */
        fun parse(text: String): MoveAnnouncement? {
            val squares = SQUARE.findAll(text).map { it.value }.toList()
            if (squares.size != 2) return null
            val words = text.lowercase(Locale.ROOT).split(' ', ',', '.').filter { it.isNotEmpty() }
            val color = words.firstNotNullOfOrNull { PieceNames.COLORS[it] } ?: return null
            // A piece name too, so other texts that happen to hold two squares don't count.
            if (words.none { it in PieceNames.PIECES }) return null
            return MoveAnnouncement(squares[0], squares[1], color)
        }
    }
}
