package com.vektra.app

import android.graphics.Typeface
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar

/**
 * The settings, saved as soon as one changes; the overlay picks them up at
 * once. Each group holds what belongs together, and a setting that only
 * matters while a switch is on sits under that switch, shown only then.
 */
class SettingsScreen(private val app: MainActivity) : MainActivity.Screen {
    private val ui = app.ui
    private var settings = SettingsStore.load(app)
    private val page = ui.column().apply { setPadding(ui.pad, ui.dp(18), ui.pad, ui.dp(28)) }
    override val view: View = ScrollView(app).apply {
        isVerticalScrollBarEnabled = false
        addView(page)
    }

    private fun save(next: HintSettings) {
        settings = next
        SettingsStore.save(app, next)
    }

    override fun shown() {
        // Built afresh each time, so it shows what the home's switch changed.
        settings = SettingsStore.load(app)
        page.removeAllViews()
        ui.screenTitle(page, "Settings")

        ui.section(page, "Arrows")
        val arrows = ui.card(page)
        arrows.addView(ui.text("How many best moves", 14f, Ui.MUTED))
        ui.segmented(arrows, listOf("1", "2", "3"), settings.arrows - 1) { save(settings.copy(arrows = it + 1)) }
        ui.switchRow(arrows, "Scores on arrows", "+1.5 means you're 1.5 pawns better", settings.arrowScores) {
            save(settings.copy(arrowScores = it))
        }
        ui.slider(arrows, { "Hide moves that cost more than $it% win chance" }, 2, 40, 1, settings.hideWorseWinLoss) {
            save(settings.copy(hideWorseWinLoss = it))
        }
        ui.switchRow(arrows, "Avoid draws", "Skip a move that draws at once when another keeps you level", settings.avoidDraws) {
            save(settings.copy(avoidDraws = it))
        }

        ui.section(page, "Threats")
        val threats = ui.card(page)
        lateinit var threatMore: LinearLayout
        ui.switchRow(threats, "Show the bot's threats", "What it would play if it were its move", settings.showThreats) {
            threatMore.visibility = if (it) View.VISIBLE else View.GONE
            save(settings.copy(showThreats = it))
        }
        threatMore = ui.dependent(threats, settings.showThreats)
        ui.slider(threatMore, { "Only when they would cost at least $it% win chance" }, 4, 40, 1, settings.threatWinLoss) {
            save(settings.copy(threatWinLoss = it))
        }

        ui.section(page, "Weaker move")
        val weaker = ui.card(page)
        lateinit var weakerMore: LinearLayout
        ui.switchRow(weaker, "Show a weaker move", "A second, violet arrow: good, but not the best", settings.occasionalWeakerMoves) {
            weakerMore.visibility = if (it) View.VISIBLE else View.GONE
            save(settings.copy(occasionalWeakerMoves = it))
        }
        weakerMore = ui.dependent(weaker, settings.occasionalWeakerMoves)
        ui.slider(weakerMore, { "Up to %.1f pawns worse than the best".format(it / 100.0) }, 10, 300, 10, settings.weakerMoveMaxLossCp) {
            save(settings.copy(weakerMoveMaxLossCp = it))
        }

        ui.section(page, "Your moves")
        val yours = ui.card(page)
        ui.switchRow(yours, "Rate my moves", "Best, Mistake… on the board after you move", settings.liveRatings) {
            save(settings.copy(liveRatings = it))
        }

        addStrength()

        ui.section(page, "Analysis")
        val review = ui.card(page)
        review.addView(ui.text("How deep each move is analysed", 14f, Ui.MUTED))
        val depths = listOf(12, 16, 20)
        ui.segmented(review, listOf("Quick", "Normal", "Deep"), depths.indexOf(settings.analysisDepth)) {
            save(settings.copy(analysisDepth = depths[it]))
        }
        review.addView(ui.text("Deeper rates moves more exactly, and takes longer", 13f, Ui.MUTED).apply {
            setPadding(0, ui.dp(10), 0, 0)
        })

        ui.section(page, "App")
        val appCard = ui.card(page)
        ui.switchRow(appCard, "Check for updates", "When Vektra opens", settings.updateCheck) { save(settings.copy(updateCheck = it)) }
        addDiagnostics(appCard)
    }

    /**
     * How strong the suggested moves are: either the full engine, set by its
     * search depth, or an approximate Elo (presets from core/settings.ts
     * ELO_PRESETS, or exact). Light mode sits here too.
     */
    private fun addStrength() {
        ui.section(page, "Strength")
        val card = ui.card(page)
        card.addView(ui.text("How strong the suggested moves are", 14f, Ui.MUTED))
        lateinit var engineRows: LinearLayout
        lateinit var eloRows: LinearLayout
        ui.segmented(card, listOf("Full engine", "Set an Elo"), if (settings.limitStrength) 1 else 0) { i ->
            engineRows.visibility = if (i == 0) View.VISIBLE else View.GONE
            eloRows.visibility = if (i == 1) View.VISIBLE else View.GONE
            save(settings.copy(limitStrength = i == 1))
        }

        engineRows = ui.dependent(card, !settings.limitStrength)
        ui.slider(engineRows, { "Search depth $it: deeper is stronger but slower" }, HintSettings.DEPTH_MIN, HintSettings.DEPTH_MAX, 1, settings.depth) {
            save(settings.copy(depth = it))
        }

        // The Elo: a preset, or exact on the slider; a preset's value lights its choice.
        eloRows = ui.dependent(card, settings.limitStrength)
        val presets = listOf(1400, 1800, 2400)
        val names = listOf("Beginner", "Club", "Strong")
        lateinit var elo: SeekBar
        val select = ui.segmented(eloRows, names, presets.indexOf(settings.elo)) { i ->
            save(settings.copy(elo = presets[i]))
            elo.progress = (presets[i] - HintSettings.ELO_MIN) / 10
        }
        elo = ui.slider(
            eloRows, { e -> "About $e Elo" + (presets.indexOf(e).takeIf { it >= 0 }?.let { " (${names[it]})" } ?: "") },
            HintSettings.ELO_MIN, HintSettings.ELO_MAX, 10, settings.elo,
            onMove = { e -> select(presets.indexOf(e)) },
        ) { e -> save(settings.copy(elo = e)) }

        ui.switchRow(card, "Light mode", "One engine: smoother arrows, hints a bit later", settings.lightMode) {
            save(settings.copy(lightMode = it))
        }
    }

    /** What Vektra last read, for finding out why hints don't show; folded until opened. */
    private fun addDiagnostics(card: LinearLayout) {
        val toggle = ui.text("Show what Vektra last read", 14f, Ui.LINK).apply { setPadding(0, ui.dp(12), 0, 0) }
        card.addView(toggle)
        val body = ui.dependent(card, false)
        val state = PositionStore.state
        val reading = (state as? PositionStore.State.On)?.reading ?: PositionStore.lastReading
        body.addView(ui.text(
            (if (state is PositionStore.State.Off) state.reason + "\n\n" else "") + (reading?.let(::describe) ?: "Nothing read yet."),
            12f, Ui.MUTED,
        ).apply {
            typeface = Typeface.MONOSPACE
            setPadding(0, ui.dp(8), 0, 0)
        })
        toggle.setOnClickListener {
            val open = body.visibility != View.VISIBLE
            body.visibility = if (open) View.VISIBLE else View.GONE
            toggle.text = if (open) "Hide what Vektra last read" else "Show what Vektra last read"
        }
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
}
