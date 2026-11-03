package com.vektra.app

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.Log
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
    private lateinit var enabledSwitch: Switch
    // The quick settings tile can switch hints while this screen is open: keep in step, or the next change here would undo it.
    private val settingsListener: (HintSettings) -> Unit = { next ->
        runOnUiThread {
            settings = next
            enabledSwitch.isChecked = next.enabled
        }
    }

    private val pad by lazy { (16 * resources.displayMetrics.density).toInt() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 3 / 2, pad, pad * 2)
        }
        layout.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 28f
            typeface = Typeface.DEFAULT_BOLD
        })
        val version = packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        layout.addView(TextView(this).apply {
            text = "Version $version. " +
                "In Chess.com bot games Vektra shows the engine's best moves over the board on your turn."
            setTextColor(MUTED)
        })
        // Filled in if a newer release is out.
        val updates = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        layout.addView(updates)
        if (SettingsStore.load(this).updateCheck) checkForUpdate(updates, version)
        layout.addView(button("Review finished games", primary = true) {
            startActivity(Intent(this, ReviewActivity::class.java))
        })

        val status = card(layout, "Status")
        serviceText = TextView(this)
        status.addView(serviceText)
        status.addView(button("Open accessibility settings", primary = false) {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        statusText = TextView(this).apply { setPadding(0, pad / 2, 0, 0) }
        status.addView(statusText)
        boardText = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 13f
            setTextColor(MUTED)
        }
        status.addView(boardText)

        settings = SettingsStore.load(this)
        addSettings(layout)
        setContentView(ScrollView(this).apply { addView(layout) })
    }

    /** Asks GitHub for the latest release; if it is newer, shows a card that installs it on a tap. */
    private fun checkForUpdate(parent: LinearLayout, running: String) {
        Thread {
            val release = try {
                AppUpdater.newerRelease(running)
            } catch (e: Exception) {
                Log.i("Vektra", "update check failed: $e")
                null
            } ?: return@Thread
            runOnUiThread {
                val card = card(parent, "Update")
                card.addView(TextView(this).apply { text = "Vektra ${release.version} is out (you have $running)." })
                lateinit var update: Button
                update = button("Update to ${release.version}", primary = true) {
                    // Android asks once whether Vektra may install apps.
                    if (!packageManager.canRequestPackageInstalls()) {
                        update.text = "Allow Vektra to install apps, then tap here again"
                        startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                        return@button
                    }
                    update.isEnabled = false
                    update.text = "Downloading…"
                    Thread {
                        try {
                            AppUpdater.install(this, AppUpdater.download(this, release))
                            runOnUiThread { update.text = "Installing…" }
                        } catch (e: Exception) {
                            Log.w("Vektra", "update failed", e)
                            runOnUiThread {
                                update.isEnabled = true
                                update.text = "Update failed (${e.message}). Tap to try again"
                            }
                        }
                    }.start()
                }
                card.addView(update)
            }
        }.start()
    }

    /** A rounded section with a small heading; its rows are added to the returned layout. */
    private fun card(parent: LinearLayout, title: String): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 3 / 4, pad, pad * 3 / 4)
            background = rounded(CARD, 14f)
        }
        card.addView(TextView(this).apply {
            text = title
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(MUTED)
            setPadding(0, 0, 0, pad / 4)
        })
        parent.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = pad * 3 / 4
        })
        return card
    }

    private fun button(label: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setTextColor(Color.WHITE)
        background = rounded(if (primary) ACCENT else LINE, 10f)
        stateListAnimator = null
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = pad * 3 / 4
        }
    }

    private fun rounded(color: Int, radiusDp: Float) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radiusDp * resources.displayMetrics.density
    }

    /** The settings, saved as soon as one changes; the overlay picks them up at once. */
    private fun addSettings(layout: LinearLayout) {
        fun save(next: HintSettings) {
            settings = next
            SettingsStore.save(this, next)
        }
        fun toggle(parent: LinearLayout, label: String, value: Boolean, change: (Boolean) -> HintSettings): Switch =
            Switch(this).apply {
                text = label
                isChecked = value
                setPadding(0, pad / 3, 0, pad / 3)
                setOnCheckedChangeListener { _, checked -> save(change(checked)) }
                parent.addView(this)
            }
        fun slider(
            parent: LinearLayout, label: (Int) -> String, min: Int, max: Int, step: Int, value: Int, change: (Int) -> HintSettings,
        ): SeekBar {
            val caption = TextView(this).apply {
                text = label(value)
                setPadding(0, pad / 3, 0, 0)
            }
            parent.addView(caption)
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
                parent.addView(this)
            }
        }

        val hints = card(layout, "Hints")
        enabledSwitch = toggle(hints, "Hints in bot games", settings.enabled) { settings.copy(enabled = it) }
        slider(hints, { "Arrows: $it" }, 1, 3, 1, settings.arrows) { settings.copy(arrows = it) }
        toggle(hints, "Scores on arrows", settings.arrowScores) { settings.copy(arrowScores = it) }
        toggle(hints, "Avoid draws (skip a move that draws at once when another keeps you level)", settings.avoidDraws) {
            settings.copy(avoidDraws = it)
        }
        slider(hints, { "Hide alternatives that cost more than $it% win chance" }, 2, 40, 1, settings.hideWorseWinLoss) {
            settings.copy(hideWorseWinLoss = it)
        }
        toggle(hints, "Rate my moves", settings.liveRatings) { settings.copy(liveRatings = it) }

        val threats = card(layout, "Threats")
        lateinit var threatLoss: SeekBar
        toggle(threats, "Show the bot's threats", settings.showThreats) {
            threatLoss.isEnabled = it
            settings.copy(showThreats = it)
        }
        threatLoss = slider(threats, { "Only when they would cost at least $it% win chance" }, 4, 40, 1, settings.threatWinLoss) {
            settings.copy(threatWinLoss = it)
        }
        threatLoss.isEnabled = settings.showThreats

        val weaker = card(layout, "Weaker moves")
        lateinit var weakerLoss: SeekBar
        toggle(weaker, "Show a weaker move (violet arrow)", settings.occasionalWeakerMoves) {
            weakerLoss.isEnabled = it
            settings.copy(occasionalWeakerMoves = it)
        }
        weakerLoss = slider(weaker, { "How much weaker: up to %.1f pawns".format(it / 100.0) }, 10, 300, 10, settings.weakerMoveMaxLossCp) {
            settings.copy(weakerMoveMaxLossCp = it)
        }
        weakerLoss.isEnabled = settings.occasionalWeakerMoves

        val strength = card(layout, "Engine")
        slider(strength, { "Search depth: $it (deeper is stronger but slower)" }, HintSettings.DEPTH_MIN, HintSettings.DEPTH_MAX, 1, settings.depth) {
            settings.copy(depth = it)
        }
        toggle(strength, "Light mode: one engine (smoother, hints a bit slower)", settings.lightMode) { settings.copy(lightMode = it) }
        lateinit var elo: SeekBar
        toggle(strength, "Play at an approximate Elo", settings.limitStrength) {
            elo.isEnabled = it
            settings.copy(limitStrength = it)
        }
        elo = slider(strength, { "Approximate Elo: $it" }, HintSettings.ELO_MIN, HintSettings.ELO_MAX, 10, settings.elo) {
            settings.copy(elo = it)
        }
        elo.isEnabled = settings.limitStrength

        val review = card(layout, "Game review")
        slider(
            review, { "Analysis depth: $it (12 is quick; deeper rates more exactly but takes longer)" },
            HintSettings.ANALYSIS_DEPTH_MIN, HintSettings.ANALYSIS_DEPTH_MAX, 1, settings.analysisDepth,
        ) { settings.copy(analysisDepth = it) }

        val about = card(layout, "Updates")
        toggle(about, "Check for updates when Vektra opens", settings.updateCheck) { settings.copy(updateCheck = it) }
    }

    override fun onResume() {
        super.onResume()
        PositionStore.addListener(listener)
        SettingsStore.addListener(settingsListener)
        settingsListener(SettingsStore.load(this))
        render()
    }

    override fun onPause() {
        PositionStore.removeListener(listener)
        SettingsStore.removeListener(settingsListener)
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

    private companion object {
        // The extension's palette (extension/src/ui/theme.ts), as in themes.xml.
        val CARD = Color.parseColor("#2f2c29")
        val LINE = Color.parseColor("#45403b")
        val MUTED = Color.parseColor("#aaa39b")
        val ACCENT = Color.parseColor("#2f6fe4")
    }

    private fun serviceEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val mine = ComponentName(this, VektraAccessibilityService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == mine }
    }
}
