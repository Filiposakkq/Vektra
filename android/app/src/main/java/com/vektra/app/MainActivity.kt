package com.vektra.app

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
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
    /** Help shown under the status when a problem is detected (showNotes). */
    private val notes by lazy { LinearLayout(this).apply { orientation = LinearLayout.VERTICAL } }

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
        status.addView(notes)
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
        toggle(hints, "Hints in bot games", settings.enabled) { settings.copy(enabled = it) }
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
        render()
    }

    override fun onPause() {
        PositionStore.removeListener(listener)
        super.onPause()
    }

    private fun render() {
        val enabled = serviceEnabled()
        val stopped = enabled && !PositionStore.serviceRunning
        val batterySaving = enabled && !getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        serviceText.text = when {
            stopped -> "Accessibility service: stopped."
            enabled -> "Accessibility service: on."
            else -> "Accessibility service: off."
        }
        showNotes(stopped, batterySaving, enabled)
        val state = PositionStore.state
        statusText.text = when (state) {
            is PositionStore.State.On -> "In a bot game."
            is PositionStore.State.Off -> state.reason
        }
        val reading = (state as? PositionStore.State.On)?.reading ?: PositionStore.lastReading
        boardText.text = reading?.let { describe(it, current = state is PositionStore.State.On) } ?: ""
    }

    /** What the notes show now; they are only rebuilt when it changes. */
    private var shownNotes = ""

    /**
     * Help for a problem, shown only while it is detected: the service off,
     * stopped by the phone, or exposed to battery saving (which is what lets
     * Xiaomi and other phones stop it).
     */
    private fun showNotes(stopped: Boolean, batterySaving: Boolean, enabled: Boolean) {
        val key = "$stopped $batterySaving $enabled"
        if (key == shownNotes) return
        shownNotes = key
        notes.removeAllViews()
        fun note(text: String) = notes.addView(TextView(this).apply {
            this.text = text
            setPadding(0, pad / 2, 0, 0)
        })
        val accessibility = { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        if (!enabled) {
            note(
                "Turn on Vektra in the accessibility settings" +
                    (if (XIAOMI) " (Additional settings → Accessibility → Downloaded apps)" else "") +
                    ". If it is greyed out or says restricted, open Vektra's app info, tap ⋮ and choose " +
                    "Allow restricted settings (Android 13 and later asks this of apps not from Google Play), then try again.",
            )
            notes.addView(button("Open accessibility settings", primary = true, onClick = accessibility))
            notes.addView(button("Open Vektra's app info", primary = false, onClick = ::openAppInfo))
            return
        }
        if (stopped) {
            // Switched on, but its process was killed: Android won't restart an accessibility service by itself.
            note(
                "Your phone stopped Vektra, and Android won't start it again by itself (it may say \"this service " +
                    "doesn't work\"). Turn Vektra off and on in the accessibility settings.\n\n" +
                    if (XIAOMI) {
                        "On Xiaomi, Redmi and POCO phones clearing recent apps does this. To prevent it: allow " +
                            "Autostart, set Battery saver to No restrictions in Vektra's app info, and lock Vektra " +
                            "in recent apps (long-press its card, then the lock)."
                    } else {
                        "On some phones (Samsung, Huawei, Honor, OnePlus, Oppo, Vivo and others) battery saving " +
                            "or clearing recent apps does this. To prevent it, allow Vektra to run in the background " +
                            "and turn off battery optimisation for it in its app info."
                    },
            )
            notes.addView(button("Open accessibility settings", primary = true, onClick = accessibility))
            if (XIAOMI) notes.addView(button("Open Autostart", primary = false, onClick = ::openAutostart))
            notes.addView(button("Open Vektra's app info", primary = false, onClick = ::openAppInfo))
        } else if (batterySaving) {
            note(
                "Battery saving is on for Vektra. Some phones (Xiaomi, Samsung, Huawei and others) then stop it in " +
                    "the background, and hints stop until you turn it off and on again. " +
                    if (XIAOMI) "In Vektra's app info, set Battery saver to No restrictions, and allow Autostart."
                    else "In Vektra's app info, turn battery optimisation off.",
            )
            notes.addView(button("Open Vektra's app info", primary = false, onClick = ::openAppInfo))
            if (XIAOMI) notes.addView(button("Open Autostart", primary = false, onClick = ::openAutostart))
        }
    }

    private fun openAppInfo() =
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))

    /** Xiaomi's Autostart list (in its Security app); app info if this phone doesn't have it. */
    private fun openAutostart() {
        try {
            startActivity(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
        } catch (e: Exception) {
            openAppInfo()
        }
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
        /** Xiaomi's own system (MIUI, HyperOS) has its own Autostart and battery rules. */
        val XIAOMI = Build.MANUFACTURER.lowercase() in setOf("xiaomi", "redmi", "poco")
    }

    private fun serviceEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val mine = ComponentName(this, VektraAccessibilityService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == mine }
    }
}
