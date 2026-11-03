package com.vektra.app

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import org.json.JSONObject
import java.io.FileNotFoundException
import java.net.URL
import java.net.URLEncoder
import java.text.DateFormat
import java.util.Date

/**
 * Review: a Chess.com player's finished games from the public archive (no
 * login), newest first, 50 at a time, older months on request. Tapping one
 * opens it to analyse. Never a game in progress.
 */
class ReviewScreen(private val app: MainActivity) : MainActivity.Screen {
    private val ui = app.ui
    private val prefs = app.getSharedPreferences("review", Context.MODE_PRIVATE)
    private val status = ui.text("", 14f, Ui.MUTED).apply { setPadding(ui.dp(4), ui.dp(14), 0, ui.dp(2)) }
    private val list = ui.column()
    private val input = EditText(app)

    /** The player's monthly archive URLs, oldest first, how many of the newest are loaded, and games not listed yet. */
    private var username = ""
    private var archives: List<String> = emptyList()
    private var loaded = 0
    private var pending: List<JSONObject> = emptyList()

    override val view: View = ScrollView(app).apply {
        isVerticalScrollBarEnabled = false
        val page = ui.column().apply { setPadding(ui.pad, ui.dp(18), ui.pad, ui.dp(28)) }
        ui.screenTitle(page, "Review")
        page.addView(ui.text("Analyse your finished games from Chess.com", 15f, Ui.MUTED))
        val search = ui.row().apply {
            setPadding(ui.dp(16), 0, ui.dp(6), 0)
            background = ui.rounded(Ui.SURFACE, 26)
        }
        search.addView(ui.icon(R.drawable.ic_search, Ui.MUTED, 20))
        input.apply {
            hint = "Chess.com username"
            setHintTextColor(Ui.MUTED)
            setTextColor(Ui.TEXT)
            textSize = 16f
            background = null
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            // That input type (no suggestions) switches to monospace: back to the app's font.
            typeface = Ui.Weight.REGULAR.typeface
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setText(prefs.getString("username", ""))
            setPadding(ui.dp(12), ui.dp(16), ui.dp(8), ui.dp(16))
            setOnEditorActionListener { _, action, event ->
                if (action == EditorInfo.IME_ACTION_SEARCH || event?.keyCode == KeyEvent.KEYCODE_ENTER) search()
                true
            }
        }
        search.addView(input, ui.weighted())
        search.addView(ui.text("Show", 15f, android.graphics.Color.WHITE, Ui.Weight.MEDIUM).apply {
            setPadding(ui.dp(18), ui.dp(10), ui.dp(18), ui.dp(10))
            background = ui.ripple(ui.rounded(Ui.ACCENT, 20), 20)
            setOnClickListener { search() }
        })
        page.addView(search, ui.fullWidth(ui.dp(20)))
        page.addView(status)
        page.addView(list)
        addView(page)
    }

    private fun search() {
        val name = input.text.toString().trim()
        if (name.isEmpty()) return
        app.getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(input.windowToken, 0)
        prefs.edit().putString("username", name).apply()
        username = name
        status.text = "Loading games…"
        list.removeAllViews()
        Thread {
            try {
                val json = JSONObject(fetch("https://api.chess.com/pub/player/${URLEncoder.encode(name.lowercase(), "UTF-8")}/games/archives"))
                val urls = json.getJSONArray("archives").strings()
                app.runOnUiThread {
                    if (username != name) return@runOnUiThread
                    archives = urls
                    loaded = 0
                    pending = emptyList()
                    status.text = "Pick a game to analyse"
                    showMore(months = 2)
                }
            } catch (e: Exception) {
                app.runOnUiThread { if (username == name) status.text = errorText(e) }
            }
        }.start()
    }

    private fun errorText(e: Exception) =
        if (e is FileNotFoundException) "No Chess.com player named $username." else "Couldn't load the games: ${e.message}."

    /** The next 50 games, loading older months first when the loaded ones run out. */
    private fun showMore(months: Int = 1) {
        val name = username
        Thread {
            try {
                var games = pending
                var count = loaded
                while (games.isEmpty() && count < archives.size) {
                    val urls = archives.subList(maxOf(0, archives.size - count - months), archives.size - count).reversed()
                    count += urls.size
                    games = urls.flatMap { url ->
                        val all = JSONObject(fetch(url)).getJSONArray("games")
                        (0 until all.length()).map { all.getJSONObject(it) }
                            .filter { it.optString("rules") == "chess" && it.has("pgn") }
                            .sortedByDescending { it.optLong("end_time") }
                    }
                }
                app.runOnUiThread {
                    if (username != name) return@runOnUiThread
                    loaded = count
                    list.findViewWithTag<View>(MORE)?.let { list.removeView(it) }
                    games.take(PAGE).forEach { list.addView(gameCard(it)) }
                    pending = games.drop(PAGE)
                    if (list.childCount == 0) status.text = "No finished games found."
                    if (pending.isNotEmpty() || loaded < archives.size) {
                        ui.button(list, if (pending.isNotEmpty()) "Show more games" else "Load older games") { showMore() }
                        list.getChildAt(list.childCount - 1).tag = MORE
                    }
                }
            } catch (e: Exception) {
                app.runOnUiThread { if (username == name) status.text = errorText(e) }
            }
        }.start()
    }

    /** One game: your colour, the opponent, the time control and date, how it ended for you. */
    private fun gameCard(g: JSONObject): View {
        val white = g.getJSONObject("white")
        val black = g.getJSONObject("black")
        val asBlack = black.optString("username").equals(username, ignoreCase = true)
        val (me, them) = if (asBlack) black to white else white to black
        val outcome = when {
            me.optString("result") == "win" -> Triple("Won", Ui.GOOD, android.graphics.Color.parseColor("#1f3414"))
            them.optString("result") == "win" -> Triple("Lost", android.graphics.Color.parseColor("#ff8a7a"), android.graphics.Color.parseColor("#3d1814"))
            else -> Triple("Draw", Ui.MUTED, Ui.SURFACE_HIGH)
        }
        val card = ui.row().apply {
            setPadding(ui.dp(16), ui.dp(16), ui.dp(16), ui.dp(16))
            background = ui.ripple(ui.rounded(Ui.SURFACE, 22), 22)
        }
        card.addView(View(app).apply {
            background = GradientDrawable().apply {
                cornerRadius = ui.dp(5).toFloat()
                setColor(if (asBlack) android.graphics.Color.parseColor("#1b1b1b") else android.graphics.Color.parseColor("#f4f1ea"))
                setStroke(ui.dp(1), Ui.LINE)
            }
        }, LinearLayout.LayoutParams(ui.dp(16), ui.dp(16)))
        val words = ui.column().apply { setPadding(ui.dp(14), 0, ui.dp(8), 0) }
        words.addView(ui.text("vs ${them.optString("username")} (${them.optInt("rating")})", 16f, weight = Ui.Weight.MEDIUM).apply {
            isSingleLine = true
            ellipsize = android.text.TextUtils.TruncateAt.END
        })
        val date = DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(g.optLong("end_time") * 1000))
        words.addView(ui.text("${g.optString("time_class").replaceFirstChar { it.uppercase() }}, $date", 13f, Ui.MUTED))
        card.addView(words, ui.weighted())
        card.addView(ui.text(outcome.first, 13f, outcome.second, Ui.Weight.MEDIUM).apply {
            setPadding(ui.dp(12), ui.dp(5), ui.dp(12), ui.dp(5))
            background = ui.rounded(outcome.third, 12)
        })
        val result = when {
            white.optString("result") == "win" -> "1-0"
            black.optString("result") == "win" -> "0-1"
            else -> "½-½"
        }
        card.setOnClickListener {
            app.openGame(GameScreen.Source(
                pgn = g.getString("pgn"), flipped = asBlack,
                title = "${white.optString("username")} – ${black.optString("username")}",
                subtitle = "$result, ${g.optString("time_class")}",
            ))
        }
        return card.also { it.layoutParams = ui.fullWidth(ui.dp(10)) }
    }

    /** A page of Chess.com's API, asked for under the app's name. */
    private fun fetch(url: String): String =
        (URL(url).openConnection() as java.net.HttpURLConnection).run {
            setRequestProperty("User-Agent", "Vektra Android app")
            inputStream.bufferedReader().use { it.readText() }
        }

    private companion object {
        const val PAGE = 50
        const val MORE = "more"
    }
}
