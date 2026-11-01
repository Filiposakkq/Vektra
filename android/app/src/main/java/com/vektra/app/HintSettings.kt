package com.vektra.app

import android.content.Context
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The settings the app offers, a subset of the extension's (core/settings.ts),
 * with the same names and defaults. The overlay page fills in the rest and
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
) {
    /** As JSON for the overlay page, with the extension's setting names. */
    fun toJson(): String =
        "{\"enabled\":$enabled,\"arrows\":$arrows,\"arrowScores\":$arrowScores,\"showThreats\":$showThreats," +
            "\"occasionalWeakerMoves\":$occasionalWeakerMoves,\"liveRatings\":$liveRatings,\"depth\":$depth," +
            "\"limitStrength\":$limitStrength,\"elo\":$elo}"

    companion object {
        const val DEPTH_MIN = 8
        const val DEPTH_MAX = 24
        const val ELO_MIN = 1320
        const val ELO_MAX = 3190
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
            .apply()
        listeners.forEach { it(settings) }
    }
}
