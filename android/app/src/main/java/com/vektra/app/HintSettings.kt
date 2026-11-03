package com.vektra.app

import android.content.Context
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The settings the app offers, a subset of the extension's (core/settings.ts),
 * with the same names and defaults (except light mode, on by default here). The overlay page fills in the rest and
 * checks every value again (sanitizeSettings).
 */
data class HintSettings(
    val enabled: Boolean = true,
    /** Number of move arrows, 1-3. */
    val arrows: Int = 3,
    val arrowScores: Boolean = true,
    val showThreats: Boolean = true,
    /** Show a weaker but playable alternative as a violet arrow. */
    val occasionalWeakerMoves: Boolean = false,
    /** Rate your moves (Best, Mistake...) on the board. */
    val liveRatings: Boolean = true,
    /** Search depth, 8-24 on a phone. */
    val depth: Int = 16,
    /** Play at an approximate Elo instead of full strength. */
    val limitStrength: Boolean = false,
    val elo: Int = 2000,
    /**
     * One engine instead of two: smoother drawing, but threats and the search
     * ahead come later. On by default here (off in the extension): two engines
     * take a phone's fast cores and the arrows lag.
     */
    val lightMode: Boolean = true,
    /** Skip a move that draws at once when another keeps you level or better. */
    val avoidDraws: Boolean = true,
    /** Alternatives that cost more than this much win chance (points) are not drawn. */
    val hideWorseWinLoss: Int = 10,
    /** A threat is shown only when allowing it would cost at least this much win chance. */
    val threatWinLoss: Int = 12,
    /** How much weaker the violet move may be, in centipawns. */
    val weakerMoveMaxLossCp: Int = 200,
    /** Depth of the game review. */
    val analysisDepth: Int = 12,
) {
    /** As JSON for the overlay page, with the extension's setting names. */
    fun toJson(): String =
        "{\"enabled\":$enabled,\"arrows\":$arrows,\"arrowScores\":$arrowScores,\"showThreats\":$showThreats," +
            "\"occasionalWeakerMoves\":$occasionalWeakerMoves,\"liveRatings\":$liveRatings,\"depth\":$depth," +
            "\"limitStrength\":$limitStrength,\"elo\":$elo,\"lightMode\":$lightMode,\"avoidDraws\":$avoidDraws," +
            "\"hideWorseWinLoss\":$hideWorseWinLoss,\"threatWinLoss\":$threatWinLoss," +
            "\"weakerMoveMaxLossCp\":$weakerMoveMaxLossCp,\"analysisDepth\":$analysisDepth}"

    companion object {
        const val DEPTH_MIN = 8
        const val DEPTH_MAX = 24
        const val ELO_MIN = 1320
        const val ELO_MAX = 3190
        const val ANALYSIS_DEPTH_MIN = 8
        const val ANALYSIS_DEPTH_MAX = 24
    }
}

/** The settings, saved on the phone, shared by the app screen and the accessibility service. */
object SettingsStore {
    private const val PREFS = "settings"
    private val listeners = CopyOnWriteArrayList<(HintSettings) -> Unit>()

    fun addListener(listener: (HintSettings) -> Unit) = listeners.add(listener)
    fun removeListener(listener: (HintSettings) -> Unit) = listeners.remove(listener)

    fun load(context: Context): HintSettings {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val d = HintSettings()
        return HintSettings(
            enabled = p.getBoolean("enabled", d.enabled),
            arrows = p.getInt("arrows", d.arrows).coerceIn(1, 3),
            arrowScores = p.getBoolean("arrowScores", d.arrowScores),
            showThreats = p.getBoolean("showThreats", d.showThreats),
            occasionalWeakerMoves = p.getBoolean("occasionalWeakerMoves", d.occasionalWeakerMoves),
            liveRatings = p.getBoolean("liveRatings", d.liveRatings),
            depth = p.getInt("depth", d.depth).coerceIn(HintSettings.DEPTH_MIN, HintSettings.DEPTH_MAX),
            limitStrength = p.getBoolean("limitStrength", d.limitStrength),
            elo = p.getInt("elo", d.elo).coerceIn(HintSettings.ELO_MIN, HintSettings.ELO_MAX),
            lightMode = p.getBoolean("lightMode", d.lightMode),
            avoidDraws = p.getBoolean("avoidDraws", d.avoidDraws),
            hideWorseWinLoss = p.getInt("hideWorseWinLoss", d.hideWorseWinLoss).coerceIn(2, 40),
            threatWinLoss = p.getInt("threatWinLoss", d.threatWinLoss).coerceIn(4, 40),
            weakerMoveMaxLossCp = p.getInt("weakerMoveMaxLossCp", d.weakerMoveMaxLossCp).coerceIn(10, 300),
            analysisDepth = p.getInt("analysisDepth", d.analysisDepth)
                .coerceIn(HintSettings.ANALYSIS_DEPTH_MIN, HintSettings.ANALYSIS_DEPTH_MAX),
        )
    }

    fun save(context: Context, settings: HintSettings) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", settings.enabled)
            .putInt("arrows", settings.arrows)
            .putBoolean("arrowScores", settings.arrowScores)
            .putBoolean("showThreats", settings.showThreats)
            .putBoolean("occasionalWeakerMoves", settings.occasionalWeakerMoves)
            .putBoolean("liveRatings", settings.liveRatings)
            .putInt("depth", settings.depth)
            .putBoolean("limitStrength", settings.limitStrength)
            .putInt("elo", settings.elo)
            .putBoolean("lightMode", settings.lightMode)
            .putBoolean("avoidDraws", settings.avoidDraws)
            .putInt("hideWorseWinLoss", settings.hideWorseWinLoss)
            .putInt("threatWinLoss", settings.threatWinLoss)
            .putInt("weakerMoveMaxLossCp", settings.weakerMoveMaxLossCp)
            .putInt("analysisDepth", settings.analysisDepth)
            .apply()
        listeners.forEach { it(settings) }
    }
}
