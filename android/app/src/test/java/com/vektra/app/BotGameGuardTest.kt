package com.vektra.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BotGameGuardTest {
    @Test
    fun `only Chess-com's bot-game screen counts`() {
        assertTrue(BotGameGuard.isBotGame("com.chess", "com.chess.features.versusbots.game.BotGameActivityV2"))
        // Live games, watched or played.
        assertFalse(BotGameGuard.isBotGame("com.chess", "com.chess.realchess.ui.game.RealGameActivity"))
        // Anything unknown, renamed or missing stays off.
        assertFalse(BotGameGuard.isBotGame("com.chess", "com.chess.features.versusbots.game.BotGameActivityV3"))
        assertFalse(BotGameGuard.isBotGame("com.chess", null))
        assertFalse(BotGameGuard.isBotGame("com.example", "com.chess.features.versusbots.game.BotGameActivityV2"))
    }

    @Test
    fun `a game with a coach is told apart by the coach's picture`() {
        assertTrue(BotGameGuard.isCoachGame(ScreenDump("coach-game.xml").labels))
        assertFalse(BotGameGuard.isCoachGame(ScreenDump("bot-game.xml").labels))
    }
}
