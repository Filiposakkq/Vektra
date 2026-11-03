package com.vektra.app

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView

/** Vektra's settings, whether its accessibility service is on, and what it last read. */
class MainActivity : Activity() {
    private lateinit var settings: HintSettings
    private lateinit var serviceText: TextView
    private lateinit var statusText: TextView
    private lateinit var boardText: TextView
    private val listener: (PositionStore.State) -> Unit = { runOnUiThread { render() } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        layout.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 26f
        })
        layout.addView(TextView(this).apply {
            text = "Version ${packageManager.getPackageInfo(packageName, 0).versionName}. " +
                "In Chess.com bot games Vektra shows the engine's best moves over the board on your turn."
        })
        serviceText = TextView(this).apply { setPadding(0, pad, 0, 0) }
        layout.addView(serviceText)
        layout.addView(Button(this).apply {
            text = "Open accessibility settings"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        })
        layout.addView(Button(this).apply {
            text = "Review finished games"
            setOnClickListener { startActivity(Intent(this@MainActivity, ReviewActivity::class.java)) }
        })
        settings = SettingsStore.load(this)
        addSettings(layout, pad)
        statusText = TextView(this).apply { setPadding(0, pad, 0, 0) }
        layout.addView(statusText)
        boardText = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 18f
            setPadding(0, pad / 2, 0, 0)
        }
        layout.addView(boardText)
        setContentView(ScrollView(this).apply { addView(layout) })
    }

    /** The settings, saved as soon as one changes; the overlay picks them up at once. */
    private fun addSettings(layout: LinearLayout, pad: Int) {
        layout.addView(TextView(this).apply {
            text = "Settings"
            textSize = 20f
            setPadding(0, pad, 0, pad / 4)
        })
        fun save(next: HintSettings) {
            settings = next
            SettingsStore.save(this, next)
        }
        fun toggle(label: String, value: Boolean, change: (Boolean) -> HintSettings): Switch =
            Switch(this).apply {
                text = label
                isChecked = value
                setPadding(0, pad / 3, 0, pad / 3)
                setOnCheckedChangeListener { _, checked -> save(change(checked)) }
                layout.addView(this)
            }
        fun slider(label: (Int) -> String, min: Int, max: Int, step: Int, value: Int, change: (Int) -> HintSettings): SeekBar {
            val caption = TextView(this).apply { text = label(value) }
            layout.addView(caption)
            return SeekBar(this).apply {
                this.max = (max - min) / step
                progress = (value - min) / step
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
                        caption.text = label(min + progress * step)
                    }
                    override fun onStartTrackingTouch(bar: SeekBar) {}
                    override fun onStopTrackingTouch(bar: SeekBar) = save(change(min + bar.progress * step))
                })
                layout.addView(this)
            }
        }

        toggle("Hints in bot games", settings.enabled) { settings.copy(enabled = it) }
        slider({ "Arrows: $it" }, 1, 3, 1, settings.arrows) { settings.copy(arrows = it) }
        toggle("Scores on arrows", settings.arrowScores) { settings.copy(arrowScores = it) }
        toggle("Show the bot's threats", settings.showThreats) { settings.copy(showThreats = it) }
        toggle("Show a weaker move (violet arrow)", settings.occasionalWeakerMoves) { settings.copy(occasionalWeakerMoves = it) }
        toggle("Rate my moves", settings.liveRatings) { settings.copy(liveRatings = it) }
        slider({ "Search depth: $it (deeper is stronger but slower)" }, HintSettings.DEPTH_MIN, HintSettings.DEPTH_MAX, 1, settings.depth) {
            settings.copy(depth = it)
        }
        toggle("Light mode: one engine (smoother, hints a bit slower)", settings.lightMode) { settings.copy(lightMode = it) }
        lateinit var elo: SeekBar
        toggle("Play at an approximate Elo", settings.limitStrength) {
            elo.isEnabled = it
            settings.copy(limitStrength = it)
        }
        elo = slider({ "Approximate Elo: $it" }, HintSettings.ELO_MIN, HintSettings.ELO_MAX, 10, settings.elo) {
            settings.copy(elo = it)
        }
        elo.isEnabled = settings.limitStrength
    }

    override fun onResume() {
        super.onResume()
        PositionStore.addListener(listener)
        render()
    }

    override fun onPause() {
        PositionStore.removeListener(listener)
        super.onPause()
    }

    private fun render() {
        serviceText.text = if (serviceEnabled() && !PositionStore.serviceRunning) {
            // Switched on, but its process was killed (recent apps cleared, battery
            // saver): Android won't restart an accessibility service by itself.
            "Accessibility service: stopped. Android stopped Vektra (clearing recent apps or the battery " +
                "saver can do this) and won't restart it by itself: turn Vektra off and on again in the " +
                "accessibility settings. To keep it running on Xiaomi, open Vektra's app info and allow " +
                "Autostart, and set Battery saver to No restrictions."
        } else if (serviceEnabled()) {
            "Accessibility service: on."
        } else {
            "Accessibility service: off. Turn on Vektra in the accessibility settings (on Xiaomi: " +
                "Additional settings → Accessibility → Downloaded apps). If it is greyed out, open " +
                "Vektra's app info, tap ⋮ and choose Allow restricted settings, then try again."
        }
        val state = PositionStore.state
        statusText.text = when (state) {
            is PositionStore.State.On -> "In a bot game."
            is PositionStore.State.Off -> state.reason
        }
        val reading = (state as? PositionStore.State.On)?.reading ?: PositionStore.lastReading
        boardText.text = reading?.let { describe(it, current = state is PositionStore.State.On) } ?: ""
    }

    private fun describe(reading: GameReading, current: Boolean): String {
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
            appendLine(if (current) "Board now:" else "Last board read:")
            shown.forEach { appendLine(it.joinToString(" ")) }
            appendLine()
            appendLine("$side, ${if (reading.board.flipped) "you play Black" else "you play White"}")
            appendLine("Moves on screen: ${reading.moves.tokens.joinToString(" ").ifEmpty { "none" }}")
            append("FEN start: ${reading.fenStart}")
        }
    }

    private fun serviceEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val mine = ComponentName(this, VektraAccessibilityService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == mine }
    }
}
