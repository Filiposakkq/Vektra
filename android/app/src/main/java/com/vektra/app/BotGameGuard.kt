package com.vektra.app

/**
 * The bot-only rule: Vektra works only on Chess.com screens known to be games
 * against its bots. Every other screen, including ones Vektra has never seen,
 * keeps it off. If Chess.com renames its bot screen, Vektra stays off until
 * this list is updated: the safe direction.
 */
object BotGameGuard {
    const val CHESS_PACKAGE = "com.chess"

    /** Chess.com's bot-game screens, as seen in app 4.10.23. */
    private val BOT_SCREENS = setOf(
        "com.chess.features.versusbots.game.BotGameActivityV2",
    )

    fun isBotGame(packageName: String?, screen: String?): Boolean =
        packageName == CHESS_PACKAGE && screen in BOT_SCREENS

    /** The coach's picture, labelled in the languages Vektra reads ("Trenér" seen in the Czech app). */
    private val COACH_LABELS = setOf("Trenér", "Coach")

    /**
     * A game with a coach uses the same bot-game screen, but Chess.com shows
     * its own suggestion and threat arrows, move feedback and eval bar there,
     * so Vektra stays off.
     */
    fun isCoachGame(labels: List<ScreenLabel>): Boolean = labels.any { it.text in COACH_LABELS }
}
