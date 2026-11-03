package com.vektra.app

import android.app.Activity
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView

/**
 * Vektra's settings, saved as soon as one changes; the overlay picks them up
 * at once. The everyday ones as plain choices, the fine-tuning folded away
 * under Advanced.
 */
class SettingsActivity : Activity() {
    private val ui by lazy { Ui(this) }
    private lateinit var settings: HintSettings

    private fun save(next: HintSettings) {
        settings = next
        SettingsStore.save(this, next)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = SettingsStore.load(this)
        val layout = ui.column().apply { setPadding(ui.pad, ui.pad, ui.pad, ui.pad * 2) }

        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(ui.text("←", 24f).apply {
            setPadding(0, 0, ui.pad, 0)
            contentDescription = "Back"
            setOnClickListener { finish() }
        })
        header.addView(ui.text("Settings", 22f, bold = true))
        layout.addView(header)

        ui.section(layout, "Hints")
        val hints = ui.card(layout)
        hints.addView(ui.text("Arrows", 14f, Ui.MUTED))
        ui.segmented(hints, listOf("1", "2", "3"), settings.arrows - 1) { save(settings.copy(arrows = it + 1)) }
        ui.switchRow(hints, "Scores on arrows", null, settings.arrowScores) { save(settings.copy(arrowScores = it)) }
        ui.switchRow(hints, "Rate my moves", "Best, Mistake… on the board", settings.liveRatings) { save(settings.copy(liveRatings = it)) }
        ui.switchRow(hints, "The bot's threats", "What it would play if it were its move", settings.showThreats) {
            save(settings.copy(showThreats = it))
        }
        ui.switchRow(hints, "Weaker move", "A second, violet arrow", settings.occasionalWeakerMoves) {
            save(settings.copy(occasionalWeakerMoves = it))
        }

        ui.section(layout, "Strength")
        val strength = ui.card(layout)
        // The extension's presets (core/settings.ts ELO_PRESETS); Maximum is full strength.
        val presets = listOf(1400, 1800, 2400)
        val preset = if (!settings.limitStrength) 3 else presets.indexOf(settings.elo)
        ui.segmented(strength, listOf("Beginner", "Club", "Strong", "Max"), preset) { i ->
            save(if (i == 3) settings.copy(limitStrength = false) else settings.copy(limitStrength = true, elo = presets[i]))
        }
        strength.addView(ui.text("How strong the suggested moves are; Advanced sets an exact Elo", 13f, Ui.MUTED).apply {
            setPadding(0, ui.dp(8), 0, 0)
        })

        ui.section(layout, "Game review")
        val review = ui.card(layout)
        val depths = listOf(12, 16, 20)
        ui.segmented(review, listOf("Quick", "Normal", "Deep"), depths.indexOf(settings.analysisDepth)) {
            save(settings.copy(analysisDepth = depths[it]))
        }
        review.addView(ui.text("Deeper rates moves more exactly, and takes longer", 13f, Ui.MUTED).apply {
            setPadding(0, ui.dp(8), 0, 0)
        })

        addAdvanced(layout)
        setContentView(ScrollView(this).apply { addView(layout) })
        ui.enter((0 until layout.childCount).map { layout.getChildAt(it) })
    }

    /** The fine-tuning, folded until opened. */
    private fun addAdvanced(layout: LinearLayout) {
        val card = ui.card(layout)
        val head = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val words = ui.column()
        words.addView(ui.text("Advanced", 15f))
        words.addView(ui.text("Depth, light mode, thresholds, updates", 13f, Ui.MUTED))
        head.addView(words, LinearLayout.LayoutParams(0, -2, 1f))
        val chevron = ui.text("⌄", 22f, Ui.MUTED)
        head.addView(chevron)
        card.addView(head)
        val body = ui.column().apply { visibility = View.GONE }
        card.addView(body)
        head.setOnClickListener {
            val open = body.visibility != View.VISIBLE
            body.visibility = if (open) View.VISIBLE else View.GONE
            chevron.animate().rotation(if (open) 180f else 0f).setDuration(220)
        }

        ui.slider(body, { "Search depth: $it (deeper is stronger but slower)" }, HintSettings.DEPTH_MIN, HintSettings.DEPTH_MAX, 1, settings.depth) {
            save(settings.copy(depth = it))
        }
        ui.switchRow(body, "Light mode", "One engine: smoother, hints a bit slower", settings.lightMode) { save(settings.copy(lightMode = it)) }
        ui.switchRow(body, "Avoid draws", "Skip a move that draws at once when another keeps you level", settings.avoidDraws) {
            save(settings.copy(avoidDraws = it))
        }
        ui.slider(body, { "Hide alternatives that cost more than $it% win chance" }, 2, 40, 1, settings.hideWorseWinLoss) {
            save(settings.copy(hideWorseWinLoss = it))
        }
        ui.slider(body, { "Show threats that would cost at least $it% win chance" }, 4, 40, 1, settings.threatWinLoss) {
            save(settings.copy(threatWinLoss = it))
        }
        ui.slider(body, { "Weaker move: up to %.1f pawns worse".format(it / 100.0) }, 10, 300, 10, settings.weakerMoveMaxLossCp) {
            save(settings.copy(weakerMoveMaxLossCp = it))
        }
        ui.slider(body, { "Exact Elo when not at Max: $it" }, HintSettings.ELO_MIN, HintSettings.ELO_MAX, 10, settings.elo) {
            save(settings.copy(elo = it))
        }
        ui.switchRow(body, "Check for updates", "When Vektra opens", settings.updateCheck) { save(settings.copy(updateCheck = it)) }

        // What Vektra last read, for finding out why hints don't show.
        body.addView(ui.text("Last board read", 13f, Ui.MUTED, bold = true).apply { setPadding(0, ui.dp(16), 0, ui.dp(4)) })
        val state = PositionStore.state
        val reading = (state as? PositionStore.State.On)?.reading ?: PositionStore.lastReading
        body.addView(ui.text(
            (if (state is PositionStore.State.Off) state.reason + "\n\n" else "") + (reading?.let(::describe) ?: "Nothing read yet."),
            12f, Ui.MUTED,
        ).apply { typeface = Typeface.MONOSPACE })
    }

    private fun describe(reading: GameReading): String {
        val side = when (reading.moves.sideToMove) {
            'w' -> "White to move"
            'b' -> "Black to move"
            else -> "side to move unknown"
        }
        val rows = reading.board.placement.split('/').map { row ->
            row.flatMap { c -> if (c.isDigit()) List(c.digitToInt()) { '.' } else listOf(c) }
        }
        // As on screen: from Black's side when the board is flipped.
        val shown = if (reading.board.flipped) rows.reversed().map { it.reversed() } else rows
        return buildString {
            shown.forEach { appendLine(it.joinToString(" ")) }
            appendLine()
            appendLine("$side, ${if (reading.board.flipped) "you play Black" else "you play White"}")
            appendLine("Moves on screen: ${reading.moves.tokens.joinToString(" ").ifEmpty { "none" }}")
            append("FEN start: ${reading.fenStart}")
        }
    }

    override fun finish() {
        super.finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(R.anim.screen_back_in, R.anim.screen_back_out)
    }
}
