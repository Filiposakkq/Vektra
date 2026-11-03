package com.vektra.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MoveAnnouncementTest {
    @Test
    fun `reads Chess-com's move announcements`() {
        // As announced on the phone (Czech app).
        assertEquals(MoveAnnouncement(listOf("d1", "d4"), 'w', 'q'), MoveAnnouncement.parse("Bílý Dáma z d1 na d4"))
        assertEquals(MoveAnnouncement(listOf("d7", "c6"), 'b', 'b'), MoveAnnouncement.parse("Černý Střelec z d7 na c6"))
        // The expected English wording.
        assertEquals(MoveAnnouncement(listOf("g1", "f3"), 'w', 'n'), MoveAnnouncement.parse("White Knight from g1 to f3"))
    }

    @Test
    fun `captures name no colour, so the side to move is taken`() {
        // As announced on the phone; the taken piece's name may be declined ("pěšce").
        assertEquals(MoveAnnouncement(listOf("d5", "d1"), null, 'r'), MoveAnnouncement.parse("Věž d5 bere věž na d1"))
        assertEquals(MoveAnnouncement(listOf("c1", "d1"), null, 'r'), MoveAnnouncement.parse("Věž c1 bere věž na d1, Šach"))
        assertEquals(MoveAnnouncement(listOf("e7", "g6"), null, 'n'), MoveAnnouncement.parse("Jezdec e7 bere pěšce na g6"))
        // The king's capture names only the square taken on.
        assertEquals(MoveAnnouncement(listOf("e2"), null, 'k'), MoveAnnouncement.parse("Král bere dámu na e2"))
    }

    @Test
    fun `castling names no square, so the king's squares for both sides are given`() {
        val short = listOf("e1", "g1", "e8", "g8")
        val long = listOf("e1", "c1", "e8", "c8")
        assertEquals(MoveAnnouncement(short, 'w', 'k'), MoveAnnouncement.parse("Bílý malá rošáda"))
        assertEquals(MoveAnnouncement(long, null, 'k'), MoveAnnouncement.parse("Velká rošáda"))
        assertEquals(MoveAnnouncement(long, 'b', 'k'), MoveAnnouncement.parse("Black castles queenside"))
        // The move list's notation is not an announcement.
        assertNull(MoveAnnouncement.parse("10. O-O-O"))
    }

    @Test
    fun `other texts are not moves`() {
        assertNull(MoveAnnouncement.parse("22."))
        assertNull(MoveAnnouncement.parse("Take e4 and d5 now"))
        assertNull(MoveAnnouncement.parse("White to move"))
        assertNull(MoveAnnouncement.parse("Bílý na tahu"))
        // A square's label: a piece but one square and no move.
        assertNull(MoveAnnouncement.parse("Věž na h1"))
    }
}
