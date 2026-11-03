package com.vektra.app


import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.format.DateUtils
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

/**
 * Vektra's home, opened before a game (is it ready?) and after one (review
 * it). The status is a corner of a board: Vektra's blue arrow draws itself
 * across it when hints will show, and it dims, with the one thing to do,
 * when they won't. Below it the reviews, as plain rows.
 */
class MainActivity : Activity() {
    private val ui by lazy { Ui(this) }
    private lateinit var board: StatusBoard
    private lateinit var statusWords: LinearLayout
    private lateinit var statusMore: LinearLayout
    private lateinit var lastGameSubtitle: TextView
    private lateinit var lastGameGroup: View
    private val listener: (PositionStore.State) -> Unit = { runOnUiThread { render() } }
    /** What the status shows now; it is only rebuilt when this changes. */
    private var shownStatus = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = ui.column().apply { setPadding(ui.pad, ui.pad, ui.pad, ui.pad * 2) }

        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(ImageView(this).apply { setImageResource(R.drawable.vektra_knight) }, LinearLayout.LayoutParams(ui.dp(36), ui.dp(36)))
        header.addView(ui.text(getString(R.string.app_name), 28f, display = true).apply { setPadding(ui.dp(8), 0, 0, 0) },
            LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(ui.gear { open(Intent(this, SettingsActivity::class.java)) })
        layout.addView(header)

        // Filled in if a newer release is out.
        val updates = ui.column()
        layout.addView(updates)
        val version = packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        if (SettingsStore.load(this).updateCheck) checkForUpdate(updates, version)

        val hero = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, ui.dp(24), 0, ui.dp(12))
        }
        board = StatusBoard(this)
        hero.addView(board, LinearLayout.LayoutParams(ui.dp(124), ui.dp(124)))
        statusWords = ui.column().apply { setPadding(ui.dp(18), 0, 0, 0) }
        hero.addView(statusWords, LinearLayout.LayoutParams(0, -2, 1f))
        layout.addView(hero)
        // The hints switch, or the fix and its steps.
        statusMore = ui.column().apply { layoutTransition = android.animation.LayoutTransition() }
        layout.addView(statusMore)

        layout.addView(View(this), LinearLayout.LayoutParams(1, ui.dp(16)))
        ui.divider(layout)
        val lastGame = ui.column()
        lastGameSubtitle = ui.listRow(lastGame, "▶︎", Ui.ACCENT, "Your last bot game") {
            open(Intent(this, ReviewActivity::class.java).putExtra(ReviewActivity.EXTRA_LAST_GAME, true))
        }
        ui.divider(lastGame)
        layout.addView(lastGame)
        lastGameGroup = lastGame
        ui.listRow(layout, "☰", Ui.BRASS, "Chess.com games") { open(Intent(this, ReviewActivity::class.java)) }.text =
            "Review your finished games, by username"
        ui.divider(layout)

        layout.addView(ui.text("What's new in $version", 13f, Ui.LINK).apply {
            gravity = Gravity.CENTER
            setPadding(0, ui.pad * 2, 0, 0)
            setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(AppUpdater.releasePage(version)))) }
        })
        setContentView(ScrollView(this).apply { addView(layout) })
    }

    /** Opens another of Vektra's screens, sliding in from the right. */
    private fun open(intent: Intent) {
        startActivity(intent)
        @Suppress("DEPRECATION")
        overridePendingTransition(R.anim.screen_in, R.anim.screen_out)
    }

    override fun onResume() {
        super.onResume()
        PositionStore.addListener(listener)
        showLastGame()
        shownStatus = ""
        render()
    }

    override fun onPause() {
        PositionStore.removeListener(listener)
        super.onPause()
    }

    /** The last bot game's row, once one was recorded. */
    private fun showLastGame() {
        val json = LastGame.load(this)
        lastGameGroup.visibility = if (json == null) View.GONE else View.VISIBLE
        if (json == null) return
        val game = runCatching { JSONObject(json) }.getOrNull() ?: return
        val moves = (game.getJSONArray("sans").length() + 1) / 2
        val side = if (game.optBoolean("flipped")) "Black" else "White"
        lastGameSubtitle.text = "$moves moves as $side, ${DateUtils.getRelativeTimeSpanString(LastGame.playedAt(this))}"
    }

    /** One status: green when hints will show, amber with the fix when they won't. */
    private class Status(
        val ok: Boolean,
        val title: String,
        val subtitle: String,
        val fix: Pair<String, () -> Unit>? = null,
        val steps: String? = null,
        val extra: List<Pair<String, () -> Unit>> = emptyList(),
    )

    private fun status(): Status {
        val enabled = serviceEnabled()
        val accessibility = { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        val appInfo = "Open Vektra's app info" to ::openAppInfo
        val autostart = listOfNotNull(if (Ui.XIAOMI) "Open Autostart" to ::openAutostart else null)
        if (!enabled) {
            return Status(
                ok = false,
                title = "Vektra is off",
                subtitle = "Turn it on in the accessibility settings",
                fix = "Turn on" to accessibility,
                steps = "Find Vektra in the accessibility settings" +
                    (if (Ui.XIAOMI) " (Additional settings → Accessibility → Downloaded apps)" else "") +
                    " and turn it on. If it is greyed out or says restricted, open Vektra's app info, tap ⋮ and " +
                    "choose Allow restricted settings (Android 13 and later ask this of apps not from Google Play), then try again.",
                extra = listOf(appInfo),
            )
        }
        if (!PositionStore.serviceRunning) {
            // Switched on, but its process was killed: Android won't restart an accessibility service by itself.
            return Status(
                ok = false,
                title = "Your phone stopped Vektra",
                subtitle = "Turn it off and on to start it again",
                fix = "Fix it" to accessibility,
                steps = "Android won't start it again by itself (it may say \"this service doesn't work\"). Turn Vektra " +
                    "off and on in the accessibility settings.\n\n" +
                    if (Ui.XIAOMI) {
                        "On Xiaomi, Redmi and POCO phones clearing recent apps does this. To prevent it: allow Autostart, " +
                            "set Battery saver to No restrictions in Vektra's app info, and lock Vektra in recent apps " +
                            "(long-press its card, then the lock)."
                    } else {
                        "On some phones (Samsung, Huawei, Honor, OnePlus, Oppo, Vivo and others) battery saving or clearing " +
                            "recent apps does this. To prevent it, allow Vektra to run in the background and turn off " +
                            "battery optimisation for it in its app info."
                    },
                extra = autostart + appInfo,
            )
        }
        if (!getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)) {
            return Status(
                ok = false,
                title = "Battery saving can stop Vektra",
                subtitle = "Hints then stop until you restart it",
                fix = "Fix it" to ::openAppInfo,
                steps = "Some phones (Xiaomi, Samsung, Huawei and others) stop apps in the background to save battery. " +
                    if (Ui.XIAOMI) "In Vektra's app info, set Battery saver to No restrictions, and allow Autostart."
                    else "In Vektra's app info, turn battery optimisation off.",
                extra = autostart,
            )
        }
        val settings = SettingsStore.load(this)
        val state = PositionStore.state
        return when {
            !settings.enabled -> Status(true, "Hints are off", "Turn them on below")
            state is PositionStore.State.On -> Status(true, "In a bot game", "Hints show on your turn")
            state is PositionStore.State.Off && state.reason.startsWith("Coach game") ->
                Status(true, "Coach game", "Chess.com shows its own hints here")
            else -> Status(true, "Ready", "Open a bot game in Chess.com")
        }
    }

    private fun render() {
        val status = status()
        val key = "${status.ok} ${status.title} ${status.subtitle}"
        if (key == shownStatus) return
        shownStatus = key
        // Ready or playing: the arrow draws itself. Hints off or a problem: the board dims.
        board.ready = status.ok && status.title != "Hints are off"
        board.play()
        statusWords.removeAllViews()
        statusWords.addView(ui.text(status.title, 25f, if (status.ok) Ui.TEXT else Ui.WARN_TEXT, display = true))
        statusWords.addView(ui.text(status.subtitle, 14f, Ui.MUTED).apply { setPadding(0, ui.dp(4), 0, 0) })
        statusMore.removeAllViews()

        if (status.ok) {
            ui.switchRow(statusMore, "Hints in bot games", null, SettingsStore.load(this).enabled) { on ->
                SettingsStore.save(this, SettingsStore.load(this).copy(enabled = on))
                render()
            }
            return
        }
        val statusCard = statusMore
        status.fix?.let { (label, action) -> ui.button(statusCard, label, Ui.WARN_FILL, Ui.WARN_ON, action) }
        val steps = ui.column().apply { visibility = View.GONE }
        steps.addView(ui.text(status.steps ?: "", 14f).apply { setPadding(0, ui.dp(10), 0, 0) })
        status.extra.forEach { (label, action) -> ui.button(steps, label, Ui.LINE, onClick = action) }
        val toggle = ui.text("Show the steps", 13f, Ui.LINK).apply {
            gravity = Gravity.CENTER
            setPadding(0, ui.dp(12), 0, 0)
        }
        toggle.setOnClickListener {
            val open = steps.visibility != View.VISIBLE
            steps.visibility = if (open) View.VISIBLE else View.GONE
            toggle.text = if (open) "Hide the steps" else "Show the steps"
        }
        statusCard.addView(toggle)
        statusCard.addView(steps)
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
                val card = ui.card(parent, border = Ui.ACCENT)
                card.addView(ui.text("Vektra ${release.version} is out", 17f, bold = true))
                card.addView(ui.text("What's new", 13f, Ui.LINK).apply {
                    setPadding(0, ui.dp(4), 0, 0)
                    setOnClickListener {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(AppUpdater.releasePage(release.version))))
                    }
                })
                lateinit var update: TextView
                update = ui.button(card, "Update to ${release.version}") {
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
                ui.enter(listOf(card))
            }
        }.start()
    }

    private fun openAppInfo() = openAppDetails(this)

    /** Xiaomi's Autostart list (in its Security app); app info if this phone doesn't have it. */
    private fun openAutostart() {
        try {
            startActivity(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
        } catch (e: Exception) {
            openAppInfo()
        }
    }

    private fun serviceEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val mine = ComponentName(this, VektraAccessibilityService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == mine }
    }
}

/** Vektra's app info, where Android and phone makers keep its battery and background settings. */
fun openAppDetails(context: Context) =
    context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
