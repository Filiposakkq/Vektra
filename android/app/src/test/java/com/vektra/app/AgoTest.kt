package com.vektra.app

import org.junit.Assert.assertEquals
import org.junit.Test

class AgoTest {
    @Test
    fun `says how long ago in English`() {
        assertEquals("just now", ago(20_000))
        assertEquals("a minute ago", ago(90_000))
        assertEquals("5 minutes ago", ago(5 * 60_000L))
        assertEquals("an hour ago", ago(70 * 60_000L))
        assertEquals("2 hours ago", ago(2 * 3_600_000L + 60_000))
        assertEquals("yesterday", ago(30 * 3_600_000L))
        assertEquals("3 days ago", ago(3 * 86_400_000L))
    }
}
