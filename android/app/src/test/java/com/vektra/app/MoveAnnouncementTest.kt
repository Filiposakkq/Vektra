package com.vektra.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MoveAnnouncementTest {
    @Test
    fun `reads Chess-com's move announcements`() {
        // As announced on the phone (Czech app).
        assertEquals(MoveAnnouncement("d1", "d4", 'w'), MoveAnnouncement.parse("Bílý Dáma z d1 na d4"))
        assertEquals(MoveAnnouncement("d7", "c6", 'b'), MoveAnnouncement.parse("Černý Střelec z d7 na c6"))
        // The expected English wording.
        assertEquals(MoveAnnouncement("g1", "f3", 'w'), MoveAnnouncement.parse("White Knight from g1 to f3"))
    }

    @Test
    fun `other texts are not moves`() {
        assertNull(MoveAnnouncement.parse("22."))
        assertNull(MoveAnnouncement.parse("Bílý Věž na h1"))
        assertNull(MoveAnnouncement.parse("Take e4 and d5 now"))
        assertNull(MoveAnnouncement.parse("White to move"))
    }
}
