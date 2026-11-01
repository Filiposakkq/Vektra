package com.vektra.app

import org.junit.Assert.assertEquals
import org.junit.Test

class MoveListParserTest {
    @Test
    fun `bot game - Black to move after 4 f4`() {
        val moves = MoveListParser.parse(ScreenDump("bot-game.xml").texts)
        assertEquals(listOf("3.", "c3", "e5", "4.", "f4"), moves.tokens)
        assertEquals('b', moves.sideToMove)
    }

    @Test
    fun `live game - numbers and moves share a text, piece icons come as lower-case letters`() {
        val moves = MoveListParser.parse(ScreenDump("live-game.xml").texts)
        assertEquals(listOf("10.", "qe2", "d6", "11.", "bd2", "Bd7", "12.", "O-O-O", "Qf6"), moves.tokens)
        assertEquals('w', moves.sideToMove)
    }

    @Test
    fun `a list starting with Black's move`() {
        assertEquals('w', MoveListParser.parse(listOf("7...", "Nf6")).sideToMove)
        assertEquals('w', MoveListParser.parse(listOf("1.", "e4", "e5", "2.")).sideToMove)
    }

    @Test
    fun `chat messages and buttons are not moves`() {
        val moves = MoveListParser.parse(listOf("Take e4 now, please!", "Zpět", "Nápověda", "1.", "e4"))
        assertEquals(listOf("1.", "e4"), moves.tokens)
        assertEquals(null, MoveListParser.parse(listOf("Zpět")).sideToMove)
    }
}
