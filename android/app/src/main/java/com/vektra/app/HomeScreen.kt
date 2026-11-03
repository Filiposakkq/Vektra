package com.vektra.app

import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/**
 * Home: whether hints will show (and, when not, the one thing to do), your
 * last game on a board, ready to analyse, and the way to Chess.com games and
 * the hint settings.
 */
class HomeScreen(private val app: MainActivity) : MainActivity.Screen {
    private val ui = app.ui
    private val status = ui.column()
    private val lastGame = ui.column()
    private lateinit var hintsSummary: TextView
    /** What the status shows now and which game is drawn; rebuilt only when they change. */
    private var shownStatus = ""
    private var shownGame: String? = null
    private var updateChecked = false
    private val updates = ui.column()

    override val view: View = ScrollView(app).apply {
        isVerticalScrollBarEnabled = false
        val page = ui.column().apply { setPadding(ui.pad, ui.dp(18), ui.pad, ui.dp(28)) }
        val header = ui.row()
        header.addView(ImageView(app).apply { setImageResource(R.drawable.vektra_knight) }, LinearLayout.LayoutParams(ui.dp(42), ui.dp(42)))
        header.addView(ui.text(app.getString(R.string.app_name), 30f, weight = Ui.Weight.HEADLINE).apply { setPadding(ui.dp(10), 0, 0, 0) })
        page.addView(header)
        page.addView(updates)
        page.addView(status, ui.fullWidth(ui.dp(18)))
        ui.section(page, "Your last game")
        page.addView(lastGame)
        ui.section(page, "More")
        ui.linkRow(page, R.drawable.ic_search, Ui.GOLD, "Chess.com games") { app.select(1) }.text = "Analyse your finished games"
        hintsSummary = ui.linkRow(page, R.drawable.ic_hint, Ui.ACCENT, "Hints") { app.select(2) }
        val version = app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: ""
        page.addView(ui.text("What's new in $version", 14f, Ui.LINK).apply {
            gravity = Gravity.CENTER
            setPadding(0, ui.dp(28), 0, 0)
            setOnClickListener { app.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(AppUpdater.releasePage(version)))) }
        })
        addView(page)
    }

    override fun shown() {
        renderStatus()
        renderLastGame()
        val s = SettingsStore.load(app)
        hintsSummary.text = "${s.arrows} ${if (s.arrows == 1) "arrow" else "arrows"}, " +
            (if (s.limitStrength) "about ${s.elo} Elo" else "full engine") + ", threats ${if (s.showThreats) "on" else "off"}"
        if (!updateChecked && s.updateCheck) {
            updateChecked = true
            checkForUpdate()
        }
    }

    private fun renderStatus() {
        val s = app.status()
        val key = "${s.ok} ${s.title} ${s.subtitle}"
        if (key == shownStatus) return
        shownStatus = key
        status.removeAllViews()
        val card = ui.card(status, border = if (s.ok) null else Ui.WARN_BORDER)
        val top = ui.row()
        top.addView(View(app).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (s.ok) Ui.GOOD else Ui.WARN_TEXT) }
        }, LinearLayout.LayoutParams(ui.dp(10), ui.dp(10)))
        top.addView(ui.text(s.title, 19f, if (s.ok) Ui.TEXT else Ui.WARN_TEXT, Ui.Weight.MEDIUM).apply { setPadding(ui.dp(10), 0, 0, 0) }, ui.weighted())
        card.addView(top)
        card.addView(ui.text(s.subtitle, 14f, Ui.MUTED).apply { setPadding(ui.dp(20), ui.dp(2), 0, 0) })
        if (s.ok) {
            ui.switchRow(card, "Hints in bot games", null, SettingsStore.load(app).enabled) { on ->
                SettingsStore.save(app, SettingsStore.load(app).copy(enabled = on))
                renderStatus()
            }
            // Straight into Chess.com, where the bot games are.
            app.packageManager.getLaunchIntentForPackage(BotGameGuard.CHESS_PACKAGE)?.let { chess ->
                ui.button(card, "Open Chess.com") { app.startActivity(chess) }
            }
            return
        }
        s.fix?.let { (label, action) -> ui.button(card, label, Ui.Button.WARN, action) }
        val steps = ui.column().apply { visibility = View.GONE }
        steps.addView(ui.text(s.steps ?: "", 14f).apply { setPadding(0, ui.dp(12), 0, 0) })
        s.extra.forEach { (label, action) -> ui.button(steps, label, onClick = action) }
        val toggle = ui.text("Show the steps", 14f, Ui.LINK).apply {
            gravity = Gravity.CENTER
            setPadding(0, ui.dp(14), 0, ui.dp(2))
        }
        toggle.setOnClickListener {
            val open = steps.visibility != View.VISIBLE
            steps.visibility = if (open) View.VISIBLE else View.GONE
            toggle.text = if (open) "Hide the steps" else "Show the steps"
        }
        card.addView(toggle)
        card.addView(steps)
    }

    /** The last bot game Vektra followed, on a board at its final position; or how to get one. */
    private fun renderLastGame() {
        val json = LastGame.load(app)
        val key = json?.let { "$it ${LastGame.playedAt(app) / 60_000}" }
        if (key == shownGame && lastGame.childCount > 0) return
        shownGame = key
        lastGame.removeAllViews()
        val card = ui.card(lastGame)
        // A warm glow from the top, like the logo's gold.
        card.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(android.graphics.Color.parseColor("#2a2317"), Ui.SURFACE)).apply {
            cornerRadius = ui.dp(24).toFloat()
        }
        val game = json?.let { runCatching { JSONObject(it) }.getOrNull() }
        val sans = game?.optJSONArray("sans")
        if (game == null || sans == null || sans.length() == 0) {
            card.addView(ui.text("Nothing to analyse yet", 18f, weight = Ui.Weight.MEDIUM))
            card.addView(ui.text("Play a bot game in Chess.com with Vektra on, from its first move, and it shows up here.", 14f, Ui.MUTED).apply {
                setPadding(0, ui.dp(6), 0, 0)
            })
            return
        }
        val flipped = game.optBoolean("flipped")
        val board = BoardView(app).apply {
            coordinates = false
            corner = 0.35f
        }
        card.addView(board, ui.fullWidth(ui.dp(4)))
        val title = ui.text("Your last game", 21f, weight = Ui.Weight.HEADLINE).apply { setPadding(0, ui.dp(16), 0, 0) }
        card.addView(title)
        val moves = (sans.length() + 1) / 2
        card.addView(ui.text(
            "$moves moves as ${if (flipped) "Black" else "White"}, ${ago(System.currentTimeMillis() - LastGame.playedAt(app))}",
            14f, Ui.MUTED,
        ).apply { setPadding(0, ui.dp(4), 0, 0) })
        ui.button(card, "Analyse game", Ui.Button.GOLD) { analyseLast() }
        // The final position and its opening, from the engine page.
        app.engine.call("game", JSONObject().put("sans", sans).toString()) { reply ->
            val fens = reply.optJSONArray("fens") ?: return@call
            val last = reply.optJSONArray("moves")?.let { it.optJSONObject(it.length() - 1) }
            board.show(fens.getString(fens.length() - 1), flipped, listOfNotNull(last?.optString("from"), last?.optString("to")))
            reply.optString("opening").takeIf { it.isNotEmpty() && it != "null" }?.let { title.text = withoutEco(it) }
        }
    }

    /** Opens the last bot game to analyse, if there is one. */
    fun analyseLast() {
        val game = LastGame.load(app)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        val sans = game.optJSONArray("sans")?.takeIf { it.length() > 0 } ?: return
        val flipped = game.optBoolean("flipped")
        val moves = (sans.length() + 1) / 2
        app.openGame(GameScreen.Source(sans = sans, flipped = flipped, title = "Your last game", subtitle = "$moves moves as ${if (flipped) "Black" else "White"}"))
    }

    /** Asks GitHub for the latest release; if it is newer, shows a card that installs it on a tap. */
    private fun checkForUpdate() {
        val running = app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: return
        Thread {
            val release = try {
                AppUpdater.newerRelease(running)
            } catch (e: Exception) {
                Log.i("Vektra", "update check failed: $e")
                null
            } ?: return@Thread
            app.runOnUiThread {
                val card = ui.card(updates, border = Ui.ACCENT, top = ui.dp(18))
                card.addView(ui.text("Vektra ${release.version} is out", 18f, weight = Ui.Weight.MEDIUM))
                card.addView(ui.text("What's new", 14f, Ui.LINK).apply {
                    setPadding(0, ui.dp(6), 0, 0)
                    setOnClickListener { app.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(AppUpdater.releasePage(release.version)))) }
                })
                lateinit var update: TextView
                // What to do now, under the button: shown once Android's window should be up.
                val help = ui.text("", 13f, Ui.MUTED).apply {
                    setPadding(ui.dp(4), ui.dp(10), ui.dp(4), 0)
                    visibility = View.GONE
                }
                val retry = { label: String, hint: String? ->
                    update.isEnabled = true
                    update.text = label
                    help.text = hint ?: ""
                    help.visibility = if (hint == null) View.GONE else View.VISIBLE
                }
                update = ui.button(card, "Update to ${release.version}", Ui.Button.ENGINE) {
                    // Android asks once whether Vektra may install apps.
                    if (!app.packageManager.canRequestPackageInstalls()) {
                        update.text = "Allow Vektra to install apps, then tap here again"
                        app.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}")))
                        return@button
                    }
                    update.isEnabled = false
                    update.text = "Downloading…"
                    help.visibility = View.GONE
                    Thread {
                        try {
                            AppUpdater.install(app, AppUpdater.download(app, release))
                        } catch (e: Exception) {
                            Log.w("Vektra", "update failed", e)
                            app.runOnUiThread { retry("Update failed (${e.message}). Tap to try again", null) }
                        }
                    }.start()
                }
                card.addView(help)
                // Android's installer can be interrupted (an app lock, Play Protect's check) and never answer:
                // the button never waits; tapping it again starts over, without downloading again.
                AppUpdater.onOutcome = { outcome, message ->
                    when (outcome) {
                        AppUpdater.Outcome.WAITING -> retry(
                            "Nothing showed up? Tap to try again",
                            "Confirm the update in Android's window. If an app lock or Play Protect asks first, " +
                                "answer it; if the window still doesn't come back, tap the button again.",
                        )
                        AppUpdater.Outcome.CANCELLED -> retry("Update cancelled. Tap to try again", null)
                        AppUpdater.Outcome.FAILED -> retry("Update didn't install (${message ?: "unknown error"}). Tap to try again", null)
                    }
                }
                ui.enter(card)
            }
        }.start()
    }
}

/** A JSON array of strings as a list. */
fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

/** An opening's name without its ECO code ("B00 Nimzowitsch Defense" is "Nimzowitsch Defense"). */
fun withoutEco(name: String) = name.replace(Regex("""^[A-E]\d\d\s+"""), "")
