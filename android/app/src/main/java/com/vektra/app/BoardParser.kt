package com.vektra.app

import java.util.Locale

/** An accessibility label on screen and where it is, e.g. "Bílý Věž na h1" at [0,719][135,854]. */
data class ScreenLabel(val text: String, val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val centerX get() = (left + right) / 2
    val centerY get() = (top + bottom) / 2
}

data class BoardReading(
    /** FEN piece placement, rank 8 first. */
    val placement: String,
    /** Shown from Black's side. */
    val flipped: Boolean,
    /** Where each square is on screen, by name ("e4"). */
    val squares: Map<String, ScreenLabel>,
)

sealed interface BoardResult {
    data class Read(val board: BoardReading) : BoardResult
    data class Unreadable(val reason: String) : BoardResult
}

/**
 * Piece and colour names in the Chess.com app's square labels, by language.
 * Czech is checked against the app; English is the expected wording, not yet
 * seen on a device.
 */
object PieceNames {
    val COLORS = mapOf(
        "bílý" to 'w', "bílá" to 'w', "bílé" to 'w', "černý" to 'b', "černá" to 'b', "černé" to 'b',
        "white" to 'w', "black" to 'b',
    )
    val PIECES = mapOf(
        "pěšec" to 'p', "jezdec" to 'n', "střelec" to 'b', "věž" to 'r', "dáma" to 'q', "král" to 'k',
        "pawn" to 'p', "knight" to 'n', "bishop" to 'b', "rook" to 'r', "queen" to 'q', "king" to 'k',
    )
}

/**
 * Reads the board from the Chess.com app's square labels: each of the 64
 * squares is labelled with its piece ("Bílý Věž na h1", White Rook on h1) or
 * as empty ("g1, prázdné"). A label Vektra can't understand makes the whole
 * board unreadable, so a misread position never reaches the engine.
 */
object BoardParser {
    private val SQUARE = Regex("""\b([a-h][1-8])\b""")
    private val EMPTY = Regex("""^([a-h][1-8]),""")

    fun parse(labels: List<ScreenLabel>): BoardResult {
        val pieces = HashMap<String, Char?>()
        val squares = HashMap<String, ScreenLabel>()
        for (label in labels) {
            val found = SQUARE.findAll(label.text).toList()
            if (found.size != 1) continue
            val square = found[0].value
            val words = label.text.replace(square, " ").lowercase(Locale.ROOT).split(' ', ',').filter { it.isNotEmpty() }
            val color = words.firstNotNullOfOrNull { PieceNames.COLORS[it] }
            val piece = words.firstNotNullOfOrNull { PieceNames.PIECES[it] }
            pieces[square] = when {
                color != null && piece != null -> if (color == 'w') piece.uppercaseChar() else piece
                EMPTY.containsMatchIn(label.text) -> null
                else -> return BoardResult.Unreadable("Unknown square label: \"${label.text}\"")
            }
            squares[square] = label
        }
        if (squares.size != 64) return BoardResult.Unreadable("Found ${squares.size} of 64 squares")
        // Rank 1 near the top of the screen means the board is shown from Black's side.
        val flipped = squares.getValue("a1").centerY < squares.getValue("h8").centerY
        val placement = (8 downTo 1).joinToString("/") { rank ->
            buildString {
                var empty = 0
                for (file in 'a'..'h') {
                    val piece = pieces["$file$rank"]
                    if (piece == null) {
                        empty++
                    } else {
                        if (empty > 0) append(empty)
                        empty = 0
                        append(piece)
                    }
                }
                if (empty > 0) append(empty)
            }
        }
        return BoardResult.Read(BoardReading(placement, flipped, squares))
    }
}
