package com.vektra.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdaterTest {
    @Test
    fun `compares versions number by number`() {
        assertTrue(AppUpdater.compareVersions("0.2.10", "0.2.9") > 0)
        assertTrue(AppUpdater.compareVersions("0.3.0", "0.2.24") > 0)
        assertTrue(AppUpdater.compareVersions("0.2.4", "0.2.5") < 0)
        assertEquals(0, AppUpdater.compareVersions("v0.2.4", "0.2.4"))
        assertTrue(AppUpdater.compareVersions("1.0", "0.9.9") > 0)
    }
}
