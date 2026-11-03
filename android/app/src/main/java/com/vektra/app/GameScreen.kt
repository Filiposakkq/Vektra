package com.vektra.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/**
 * A game, analysed: the board with the move played, its rating badge and
 * the better move (and, on Line, the engine's line); the moves as a strip;
 * and under them each side's accuracy, a win-chance graph, the move's
 * verdict, the phases and the ratings. All native; the engine page
 * (EnginePage) reads and analyses the game and works out the arrows.
 */
@SuppressLint("ClickableViewAccessibility")
class GameScreen(private val app: MainActivity, private val source: Source, private val onClosed: (View) -> Unit) {
    /** A game to open: its PGN (a Chess.com game) or its moves (the last bot game), and who you were. */
    class Source(val pgn: String? = null, val sans: JSONArray? = null, val flipped: Boolean, val title: String, val subtitle: String)

    private val ui = app.ui
    private val prefs = app.getSharedPreferences("review", Context.MODE_PRIVATE)
    private var fens: List<String> = emptyList()
    private var moves: List<JSONObject> = emptyList()
    private var ply = 0
    private var shownPly = 0
    private var analysis: JSONObject? = null
    private var showLine = prefs.getBoolean("line", false)
    private val chips = ArrayList<TextView>()

    private val board = BoardView(app)
    private val marks = OverlayView(app, 0)
    private val strip = ui.row()
    private val stripScroll = HorizontalScrollView(app).apply {
        isHorizontalScrollBarEnabled = false
        addView(strip)
    }
    private val details = ui.column().apply { setPadding(ui.pad, ui.dp(8), ui.pad, ui.dp(32)) }
    private val progressText = ui.text("Reading the game…", 15f, Ui.MUTED)
    private val progressBar = ProgressBar(app, null, android.R.attr.progressBarStyleHorizontal).apply {
        max = 100
        progressTintList = android.content.res.ColorStateList.valueOf(Ui.GOLD)
        progressBackgroundTintList = android.content.res.ColorStateList.valueOf(Ui.LINE)
    }
    private lateinit var lineToggle: TextView
    private var moveCard: LinearLayout? = null
    private var graph: EvalGraph? = null

    val view: View = ui.column().apply {
        setBackgroundColor(Ui.BG)
        isClickable = true
        addView(topBar())
        val frame = FrameLayout(app)
        frame.addView(board, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        frame.addView(marks, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        swipeToStep(frame)
        addView(frame)
        val moves = ui.row().apply { setPadding(ui.dp(8), ui.dp(10), ui.dp(8), ui.dp(10)) }
        moves.addView(stepButton(R.drawable.ic_back) { go(-1) })
        moves.addView(stripScroll, ui.weighted().apply { marginStart = ui.dp(6); marginEnd = ui.dp(6) })
        moves.addView(stepButton(R.drawable.ic_chevron) { go(1) })
        addView(moves)
        addView(ScrollView(app).apply {
            isVerticalScrollBarEnabled = false
            addView(details)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        details.addView(progressText)
        details.addView(progressBar, ui.fullWidth(ui.dp(10)))
        // It slides up into place, as it was opened.
        translationY = ui.dp(48).toFloat()
        alpha = 0f
        animate().translationY(0f).alpha(1f).setDuration(260).setInterpolator(DecelerateInterpolator(2f))
    }

    init {
        app.engine.onFrame = { marks.show(it) }
        app.engine.onProgress = { done, total ->
            progressText.text = "Analysing… $done of $total positions"
            progressBar.progress = done * 100 / maxOf(1, total)
        }
        val input = JSONObject().apply {
            source.pgn?.let { put("pgn", it) }
            source.sans?.let { put("sans", it) }
        }
        app.engine.call("game", input.toString()) { game ->
            val fenList = game.optJSONArray("fens") ?: return@call failed(game.optString("error", "The game couldn't be read."))
            fens = fenList.strings()
            moves = game.getJSONArray("moves").let { list -> (0 until list.length()).map { list.getJSONObject(it) } }
            buildStrip()
            show()
            analyse()
        }
    }

    private fun topBar(): View {
        val bar = ui.row().apply { setPadding(ui.dp(8), ui.dp(10), ui.dp(12), ui.dp(10)) }
        bar.addView(FrameLayout(app).apply {
            background = ui.ripple(ui.rounded(Ui.BG, 22), 22)
            addView(ui.icon(R.drawable.ic_back, Ui.TEXT), FrameLayout.LayoutParams(ui.dp(24), ui.dp(24), Gravity.CENTER))
            contentDescription = "Back"
            setOnClickListener { close() }
        }, LinearLayout.LayoutParams(ui.dp(44), ui.dp(44)))
        val words = ui.column().apply { setPadding(ui.dp(8), 0, ui.dp(8), 0) }
        words.addView(ui.text(source.title, 18f, weight = Ui.Weight.HEADLINE).apply {
            isSingleLine = true
            ellipsize = android.text.TextUtils.TruncateAt.END
        })
        words.addView(ui.text(source.subtitle, 13f, Ui.MUTED))
        bar.addView(words, ui.weighted())
        lineToggle = ui.text("Line", 14f, Ui.TEXT, Ui.Weight.MEDIUM).apply {
            setPadding(ui.dp(16), ui.dp(9), ui.dp(16), ui.dp(9))
            contentDescription = "The engine's best line from here"
            setOnClickListener {
                showLine = !showLine
                prefs.edit().putBoolean("line", showLine).apply()
                styleLine()
                show()
            }
        }
        styleLine()
        bar.addView(lineToggle)
        return bar
    }

    private fun styleLine() {
        lineToggle.background = ui.ripple(ui.rounded(if (showLine) Ui.ACCENT else Ui.SURFACE_HIGH, 18), 18)
        lineToggle.setTextColor(if (showLine) Color.WHITE else Ui.TEXT)
    }

    private fun stepButton(icon: Int, onClick: () -> Unit) = FrameLayout(app).apply {
        background = ui.ripple(ui.rounded(Ui.SURFACE, 14), 14)
        addView(ui.icon(icon, Ui.TEXT, 22), FrameLayout.LayoutParams(ui.dp(22), ui.dp(22), Gravity.CENTER))
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ui.dp(40), ui.dp(40))
    }

    /** A swipe across the board: the next move (to the left) or the one before. */
    private fun swipeToStep(target: View) {
        var fromX = 0f
        var fromY = 0f
        target.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { fromX = e.x; fromY = e.y }
                MotionEvent.ACTION_UP -> {
                    val dx = e.x - fromX
                    if (Math.abs(dx) > ui.dp(40) && Math.abs(dx) > Math.abs(e.y - fromY)) go(if (dx < 0) 1 else -1)
                }
            }
            true
        }
    }

    private fun buildStrip() {
        strip.removeAllViews()
        chips.clear()
        moves.forEachIndexed { i, m ->
            val chip = ui.text(if (i % 2 == 0) "${i / 2 + 1}. ${m.getString("san")}" else m.getString("san"), 14f, Ui.TEXT, Ui.Weight.MEDIUM).apply {
                gravity = Gravity.CENTER_VERTICAL
                setPadding(ui.dp(12), ui.dp(9), ui.dp(12), ui.dp(9))
                compoundDrawablePadding = ui.dp(6)
                setOnClickListener { select(i + 1) }
            }
            strip.addView(chip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginEnd = ui.dp(6)
            })
            chips += chip
        }
    }

    private fun go(step: Int) = select(ply + step)

    private fun select(next: Int) {
        if (fens.isEmpty()) return
        ply = next.coerceIn(0, fens.size - 1)
        show()
    }

    /** The board at `ply`, the move that led there marked; once analysed, its marks and verdict. */
    private fun show() {
        if (fens.isEmpty()) return
        val last = moves.getOrNull(ply - 1)
        board.show(fens[ply], source.flipped, listOfNotNull(last?.getString("from"), last?.getString("to")))
        // One move forward or back: the piece glides there.
        if (ply == shownPly + 1 && last != null) board.slide(last.getString("from"), last.getString("to"))
        if (ply == shownPly - 1) moves.getOrNull(ply)?.let { board.slide(it.getString("to"), it.getString("from")) }
        shownPly = ply
        chips.forEachIndexed { i, chip ->
            val on = i == ply - 1
            chip.background = ui.ripple(ui.rounded(if (on) Ui.ACCENT else Ui.SURFACE, 14), 14)
            chip.setTextColor(if (on) Color.WHITE else Ui.TEXT)
        }
        chips.getOrNull(ply - 1)?.let { chip ->
            stripScroll.post { stripScroll.smoothScrollTo(chip.left - (stripScroll.width - chip.width) / 2, 0) }
        } ?: stripScroll.smoothScrollTo(0, 0)
        if (analysis != null) app.engine.frame(ply, showLine, source.flipped) else marks.clear()
        graph?.current = ply
        renderMove()
    }

    private fun analyse() {
        analysis = null
        details.removeAllViews()
        progressText.text = "Analysing…"
        progressBar.progress = 0
        details.addView(progressText)
        details.addView(progressBar, ui.fullWidth(ui.dp(10)))
        chips.forEach { it.setCompoundDrawables(null, null, null, null) }
        val depth = SettingsStore.load(app).analysisDepth
        app.engine.call("analyze", JSONObject().put("sans", JSONArray(moves.map { it.getString("san") })).put("depth", depth).toString()) { result ->
            if (result.has("error")) return@call failed(result.getString("error"))
            analysis = result
            result.getJSONArray("moves").let { list ->
                for (i in 0 until list.length()) chips.getOrNull(i)?.setCompoundDrawables(icon(list.getJSONObject(i).getString("category"), 16), null, null, null)
            }
            renderSummary(result)
            show()
        }
    }

    private fun failed(message: String) {
        details.removeAllViews()
        details.addView(ui.text(message, 15f, Ui.WARN_TEXT))
        ui.button(details, "Try again", Ui.Button.GOLD) { analyse() }
    }

    /** A rating icon (from the engine page's drawings), at `sizeDp`. */
    private fun icon(category: String, sizeDp: Int): Drawable? {
        val png = app.icons[category] ?: return null
        val bytes = Base64.decode(png, Base64.DEFAULT)
        return BitmapDrawable(app.resources, BitmapFactory.decodeByteArray(bytes, 0, bytes.size)).apply {
            setBounds(0, 0, ui.dp(sizeDp), ui.dp(sizeDp))
        }
    }

    private fun renderSummary(a: JSONObject) {
        details.removeAllViews()
        a.optString("opening").takeIf { it.isNotEmpty() && it != "null" }?.let {
            details.addView(ui.text(it, 14f, Ui.MUTED).apply { setPadding(ui.dp(4), 0, 0, ui.dp(10)) })
        }
        // Each side's accuracy, yours marked in gold.
        val sides = ui.row()
        listOf("white" to "White", "black" to "Black").forEach { (key, name) ->
            val s = a.getJSONObject(key)
            val light = key == "white"
            val yours = (key == "black") == source.flipped
            val box = ui.column().apply {
                setPadding(ui.dp(16), ui.dp(14), ui.dp(16), ui.dp(14))
                background = ui.rounded(if (light) Color.parseColor("#ebe6df") else Ui.SURFACE, 22, if (yours) Ui.GOLD else null)
            }
            val fg = if (light) Color.parseColor("#26231f") else Ui.TEXT
            box.addView(ui.text(if (yours) "You, $name" else name, 13f, fg).apply { alpha = 0.75f })
            box.addView(ui.text("%.1f%%".format(s.getDouble("accuracy")), 34f, fg, Ui.Weight.NUMBER))
            box.addView(ui.text("Game rating ~${s.getInt("rating")}", 13f, fg).apply { alpha = 0.75f })
            sides.addView(box, ui.weighted().apply { if (light) marginEnd = ui.dp(10) })
        }
        details.addView(sides)

        val categories = a.getJSONArray("categories").let { list -> (0 until list.length()).map { list.getJSONObject(it) } }
        val colors = categories.associate { it.getString("id") to Color.parseColor(it.getString("color")) }
        val wins = a.getJSONArray("wins").let { list -> (0 until list.length()).map { list.getDouble(it).toFloat() } }
        val notable = a.getJSONArray("moves").let { list ->
            (0 until list.length()).mapNotNull { i -> list.getJSONObject(i).getString("category").takeIf { it in NOTABLE }?.let { (i + 1) to colors.getValue(it) } }
        }
        graph = EvalGraph(app, wins, notable) { select(it) }.also {
            it.current = ply
            details.addView(it, ui.fullWidth(ui.dp(14)).apply { height = ui.dp(108) })
        }

        moveCard = ui.card(details, top = ui.dp(14))
        renderMove()

        // Each part of the game, graded like a move.
        ui.section(details, "Phases")
        val phases = ui.card(details)
        val phaseNames = a.getJSONArray("phases").strings()
        tableHead(phases)
        phaseNames.forEachIndexed { i, name ->
            val row = ui.row().apply { setPadding(0, ui.dp(8), 0, ui.dp(8)) }
            row.addView(ui.text(name, 15f), ui.weighted())
            listOf("white", "black").forEach { key ->
                val p = a.getJSONObject(key).getJSONArray("phases").getJSONObject(i)
                val cell = ui.text(
                    when {
                        p.getInt("moves") == 0 -> "–"
                        p.isNull("accuracy") -> "Book"
                        else -> "${Math.round(p.getDouble("accuracy"))}%"
                    }, 15f, Ui.TEXT, Ui.Weight.MEDIUM,
                ).apply {
                    gravity = Gravity.END or Gravity.CENTER_VERTICAL
                    compoundDrawablePadding = ui.dp(6)
                    if (p.getInt("moves") > 0) setCompoundDrawables(icon(p.getString("grade"), 16), null, null, null)
                }
                row.addView(cell, LinearLayout.LayoutParams(ui.dp(84), ViewGroup.LayoutParams.WRAP_CONTENT))
            }
            phases.addView(row)
        }

        ui.section(details, "Move ratings")
        val ratings = ui.card(details)
        tableHead(ratings)
        categories.forEachIndexed { i, c ->
            val w = a.getJSONObject("white").getJSONArray("counts").getInt(i)
            val b = a.getJSONObject("black").getJSONArray("counts").getInt(i)
            val row = ui.row().apply {
                setPadding(0, ui.dp(7), 0, ui.dp(7))
                alpha = if (w == 0 && b == 0) 0.4f else 1f
            }
            row.addView(ui.text(c.getString("label"), 15f).apply {
                compoundDrawablePadding = ui.dp(10)
                setCompoundDrawables(icon(c.getString("id"), 18), null, null, null)
                gravity = Gravity.CENTER_VERTICAL
            }, ui.weighted())
            listOf(w, b).forEach { n ->
                row.addView(ui.text("$n", 15f, Ui.TEXT, Ui.Weight.NUMBER).apply { gravity = Gravity.END }, LinearLayout.LayoutParams(ui.dp(84), ViewGroup.LayoutParams.WRAP_CONTENT))
            }
            ratings.addView(row)
        }

        ui.button(details, "Analyse again") { analyse() }
        details.addView(ui.text(
            "${a.optString("engine")}, depth ${a.optInt("depth")}. Accuracy and ratings are engine estimates, not official ratings.",
            12f, Ui.MUTED,
        ).apply { setPadding(ui.dp(4), ui.dp(14), ui.dp(4), 0) })
        ui.enter(details)
    }

    private fun tableHead(card: LinearLayout) {
        val head = ui.row()
        head.addView(View(app), ui.weighted())
        listOf("White", "Black").forEach {
            head.addView(ui.text(it, 13f, Ui.MUTED).apply { gravity = Gravity.END }, LinearLayout.LayoutParams(ui.dp(84), ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        card.addView(head)
    }

    /** The move shown, in words: how it was rated, why, and what was better. */
    private fun renderMove() {
        val card = moveCard ?: return
        card.removeAllViews()
        val m = analysis?.getJSONArray("moves")?.optJSONObject(ply - 1)
        if (m == null) {
            card.addView(ui.text("Pick a move, or a point on the graph, to see how it was rated.", 15f, Ui.MUTED))
            return
        }
        card.addView(ui.text(m.getString("verdict"), 17f, weight = Ui.Weight.MEDIUM).apply {
            compoundDrawablePadding = ui.dp(10)
            setCompoundDrawables(icon(m.getString("category"), 22), null, null, null)
            gravity = Gravity.CENTER_VERTICAL
        })
        m.optString("reason").takeIf { it.isNotEmpty() && it != "null" }?.let {
            card.addView(ui.text(it, 15f).apply { setPadding(0, ui.dp(8), 0, 0) })
        }
        card.addView(ui.text(m.getString("details"), 13f, Ui.MUTED).apply { setPadding(0, ui.dp(6), 0, 0) })
    }

    /** Closes the game, sliding down; the analysis stops. */
    fun close() {
        app.engine.cancel()
        app.engine.onFrame = null
        app.engine.onProgress = null
        view.animate().translationY(ui.dp(48).toFloat()).alpha(0f).setDuration(200).withEndAction { onClosed(view) }
    }

    private companion object {
        /** Moves the graph marks with a dot. */
        val NOTABLE = setOf("brilliant", "great", "inaccuracy", "mistake", "miss", "blunder")
    }
}

/**
 * White's win chance through the game, white below the line on the night
 * background, dots on the notable moves, a line at the move shown; tap or
 * drag to go to a move.
 */
@SuppressLint("ViewConstructor", "ClickableViewAccessibility")
class EvalGraph(context: Context, private val wins: List<Float>, private val dots: List<Pair<Int, Int>>, onPick: (Int) -> Unit) : View(context) {
    var current = 0
        set(value) {
            field = value
            invalidate()
        }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val area = Path()

    init {
        setOnTouchListener { _, e ->
            if (e.actionMasked == MotionEvent.ACTION_DOWN || e.actionMasked == MotionEvent.ACTION_MOVE) {
                parent?.requestDisallowInterceptTouchEvent(true)
                onPick(Math.round(e.x / width * (wins.size - 1)).coerceIn(0, wins.size - 1))
            }
            true
        }
    }

    override fun onDraw(canvas: Canvas) {
        if (wins.size < 2) return
        val w = width.toFloat()
        val h = height.toFloat()
        val r = h * 0.12f
        canvas.save()
        canvas.clipPath(Path().apply { addRoundRect(0f, 0f, w, h, r, r, Path.Direction.CW) })
        fill.color = Ui.SURFACE
        canvas.drawRect(0f, 0f, w, h, fill)
        val x = { i: Int -> i * w / (wins.size - 1) }
        val y = { win: Float -> h - win / 100f * h }
        area.reset()
        area.moveTo(0f, h)
        wins.forEachIndexed { i, win -> area.lineTo(x(i), y(win)) }
        area.lineTo(w, h)
        area.close()
        fill.color = Color.parseColor("#e9e4dc")
        canvas.drawPath(area, fill)
        line.color = Color.argb(70, 128, 128, 128)
        line.strokeWidth = 1f
        canvas.drawLine(0f, h / 2, w, h / 2, line)
        line.color = Ui.ACCENT
        line.strokeWidth = h * 0.025f
        canvas.drawLine(x(current), 0f, x(current), h, line)
        dots.forEach { (i, color) ->
            fill.color = color
            canvas.drawCircle(x(i), y(wins[i]), h * 0.045f, fill)
        }
        canvas.restore()
    }
}
