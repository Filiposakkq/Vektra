package com.vektra.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BoardParserTest {
    private fun read(labels: List<ScreenLabel>): BoardReading {
        val result = BoardParser.parse(labels)
        assertTrue("expected a board, got $result", result is BoardResult.Read)
        return (result as BoardResult.Read).board
    }

    @Test
    fun `reads a bot game from the Czech app, shown from Black's side`() {
        val board = read(ScreenDump("bot-game.xml").labels)
        // 1. Na3 d5 2. Nh3 Nc6 3. c3 e5 4. f4
        assertEquals("r1bqkbnr/ppp2ppp/2n5/3pp3/5P2/N1P4N/PP1PP1PP/R1BQKB1R", board.placement)
        assertTrue(board.flipped)
        assertEquals(64, board.squares.size)
        // h1 is in the top-left corner when the board is flipped.
        assertEquals(ScreenLabel("Bílý Věž na h1", 0, 719, 135, 854), board.squares["h1"])
    }

    @Test
    fun `reads a watched live game too`() {
        val board = read(ScreenDump("live-game.xml").labels)
        assertEquals(64, board.squares.size)
        assertEquals(8, board.placement.split('/').size)
    }

    @Test
    fun `reads English labels`() {
        val labels = ScreenDump("bot-game.xml").labels.map { label ->
            label.copy(
                text = label.text
                    .replace("Bílý", "White").replace("Černý", "Black")
                    .replace("Pěšec", "Pawn").replace("Jezdec", "Knight").replace("Střelec", "Bishop")
                    .replace("Věž", "Rook").replace("Dáma", "Queen").replace("Král", "King")
                    .replace(" na ", " on ").replace("prázdné", "empty"),
            )
        }
        assertEquals("r1bqkbnr/ppp2ppp/2n5/3pp3/5P2/N1P4N/PP1PP1PP/R1BQKB1R", read(labels).placement)
    }

    @Test
    fun `an unknown label makes the board unreadable`() {
        val labels = ScreenDump("bot-game.xml").labels.map {
            if (it.text == "Bílý Dáma na d1") it.copy(text = "Weiße Dame auf d1") else it
        }
        val result = BoardParser.parse(labels)
        assertEquals(BoardResult.Unreadable("Unknown square label: \"Weiße Dame auf d1\""), result)
    }

    @Test
    fun `a board with missing squares is unreadable`() {
        val labels = ScreenDump("bot-game.xml").labels.filterNot { it.text.endsWith("a1") }
        assertEquals(BoardResult.Unreadable("Found 63 of 64 squares"), BoardParser.parse(labels))
    }

    @Test
    fun `labels without exactly one square are ignored`() {
        val labels = ScreenDump("bot-game.xml").labels + ScreenLabel("Zpět", 0, 0, 10, 10)
        assertFalse(read(labels).squares.containsKey("Zpět"))
    }
}
