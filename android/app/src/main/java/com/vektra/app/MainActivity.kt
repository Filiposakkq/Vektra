package com.vektra.app

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout

/**
 * Vektra's app: three tabs (Home, Review, Settings) over a bottom bar, the
 * game screen over them when a game is open, and the hidden engine page
 * (EnginePage) that reads and analyses games for them. All screens are
 * native; the look is in Ui.
 */
class MainActivity : Activity() {
    val ui by lazy { Ui(this) }
    lateinit var engine: EnginePage
        private set
    /** The rating icons (category to PNG base64), once the engine page drew them. */
    var icons: Map<String, String> = emptyMap()
        private set
    private lateinit var root: FrameLayout
    private lateinit var content: FrameLayout
    private lateinit var tabs: List<Screen>
    private val navItems = ArrayList<Pair<View, android.widget.ImageView>>()
    private val navLabels = ArrayList<android.widget.TextView>()
    private var current = 0
    private var game: GameScreen? = null
    private val listener: (PositionStore.State) -> Unit = { runOnUiThread { tabs[0].shown() } }

    /** A screen of the app: its view, refreshed whenever it comes into sight. */
    interface Screen {
        val view: View
        fun shown() {}
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this).apply { setBackgroundColor(Ui.BG) }
        engine = EnginePage(this, root)
        engine.call("icons", "{}") { json -> icons = json.keys().asSequence().associateWith { json.getString(it) } }
        val column = ui.column()
        content = FrameLayout(this)
        column.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        column.addView(bottomBar())
        root.addView(column, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        tabs = listOf(HomeScreen(this), ReviewScreen(this), SettingsScreen(this))
        setContentView(root)
        select(0)
    }

    /** Home, Review and Settings; the current one's icon sits on a gold-tinted pill. */
    private fun bottomBar(): View {
        val bar = ui.row().apply {
            setBackgroundColor(Ui.SURFACE)
            setPadding(0, ui.dp(8), 0, ui.dp(10))
        }
        listOf(R.drawable.ic_home to "Home", R.drawable.ic_review to "Review", R.drawable.ic_settings to "Settings").forEachIndexed { i, (res, label) ->
            val item = ui.column().apply {
                gravity = Gravity.CENTER_HORIZONTAL
                setOnClickListener { select(i) }
            }
            val pill = FrameLayout(this)
            val icon = ui.icon(res, Ui.MUTED)
            pill.addView(icon, FrameLayout.LayoutParams(ui.dp(24), ui.dp(24), Gravity.CENTER))
            item.addView(pill, LinearLayout.LayoutParams(ui.dp(60), ui.dp(32)))
            val text = ui.text(label, 12f, Ui.MUTED, Ui.Weight.MEDIUM).apply { setPadding(0, ui.dp(4), 0, 0) }
            item.addView(text)
            navItems += pill to icon
            navLabels += text
            bar.addView(item, ui.weighted())
        }
        return bar
    }

    /** Shows a tab, fading in. */
    fun select(index: Int) {
        current = index
        content.removeAllViews()
        val view = tabs[index].view
        (view.parent as? ViewGroup)?.removeView(view)
        content.addView(view)
        view.alpha = 0f
        view.animate().alpha(1f).setDuration(180)
        tabs[index].shown()
        navItems.forEachIndexed { i, (pill, icon) ->
            val on = i == index
            pill.background = if (on) ui.rounded(android.graphics.Color.argb(46, 240, 185, 58), 16) else null
            icon.imageTintList = android.content.res.ColorStateList.valueOf(if (on) Ui.GOLD else Ui.MUTED)
            navLabels[i].setTextColor(if (on) Ui.TEXT else Ui.MUTED)
        }
    }

    /** Opens a game over the tabs, to analyse it. */
    fun openGame(source: GameScreen.Source) {
        game?.close()
        game = GameScreen(this, source) {
            root.removeView(it)
            game = null
        }.also { root.addView(it.view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)) }
    }

    override fun onResume() {
        super.onResume()
        PositionStore.addListener(listener)
        tabs[current].shown()
    }

    override fun onPause() {
        PositionStore.removeListener(listener)
        super.onPause()
    }

    @Deprecated("Still called on the Android versions Vektra supports")
    override fun onBackPressed() {
        when {
            game != null -> game?.close()
            current != 0 -> select(0)
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    override fun onDestroy() {
        game?.close()
        engine.destroy()
        super.onDestroy()
    }

    /** One status: hints will show (ok), or why not and the one thing to do. */
    class Status(
        val ok: Boolean,
        val title: String,
        val subtitle: String,
        val fix: Pair<String, () -> Unit>? = null,
        val steps: String? = null,
        val extra: List<Pair<String, () -> Unit>> = emptyList(),
    )

    fun status(): Status {
        val enabled = serviceEnabled()
        val accessibility = { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        val appInfo = "Open Vektra's app info" to { openAppDetails(this) }
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
                fix = "Fix it" to { openAppDetails(this) },
                steps = "Some phones (Xiaomi, Samsung, Huawei and others) stop apps in the background to save battery. " +
                    if (Ui.XIAOMI) "In Vektra's app info, set Battery saver to No restrictions, and allow Autostart."
                    else "In Vektra's app info, turn battery optimisation off.",
                extra = autostart,
            )
        }
        val settings = SettingsStore.load(this)
        val state = PositionStore.state
        return when {
            !settings.enabled -> Status(true, "Hints are off", "Turn them on to see hints in bot games")
            state is PositionStore.State.On -> Status(true, "In a bot game", "Hints show on your turn")
            state is PositionStore.State.Off && state.reason.startsWith("Coach game") ->
                Status(true, "Coach game", "Chess.com shows its own hints here")
            else -> Status(true, "Ready", "Open a bot game in Chess.com")
        }
    }

    /** Xiaomi's Autostart list (in its Security app); app info if this phone doesn't have it. */
    private fun openAutostart() {
        try {
            startActivity(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
        } catch (e: Exception) {
            openAppDetails(this)
        }
    }

    private fun serviceEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val mine = ComponentName(this, VektraAccessibilityService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == mine }
    }
}

/**
 * The last bot game Vektra followed from its first move, as the overlay page
 * recorded it ({"sans": [...], "flipped": ...}): Chess.com's public archive
 * has no bot games, so this is the only way to analyse one.
 */
object LastGame {
    private const val PREFS = "lastGame"

    fun save(context: Context, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("game", json)
            .putLong("at", System.currentTimeMillis())
            .apply()
    }

    fun load(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("game", null)

    /** When it was last played (milliseconds), or 0. */
    fun playedAt(context: Context): Long = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("at", 0)
}

/** Vektra's app info, where Android and phone makers keep its battery and background settings. */
fun openAppDetails(context: Context) =
    context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))

/** How long ago, in English like the rest of the app (Android's own wording follows the phone's language). */
fun ago(ms: Long): String {
    val minutes = ms / 60_000
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> if (minutes == 1L) "a minute ago" else "$minutes minutes ago"
        minutes < 24 * 60 -> (minutes / 60).let { if (it == 1L) "an hour ago" else "$it hours ago" }
        else -> (minutes / (24 * 60)).let { if (it == 1L) "yesterday" else "$it days ago" }
    }
}
