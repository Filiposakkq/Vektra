package com.vektra.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView

/**
 * Vektra's look on Android, shared by its screens: the extension's palette
 * (extension/src/ui/theme.ts, also in themes.xml) and the pieces the screens
 * are built from, with a little motion so they feel alive.
 */
class Ui(private val context: Context) {
    val pad = dp(16)

    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()

    fun rounded(color: Int, radiusDp: Int, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp).toFloat()
        stroke?.let { setStroke(dp(1), it) }
    }

    fun text(value: CharSequence, size: Float = 15f, color: Int = TEXT, bold: Boolean = false, display: Boolean = false) = TextView(context).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        if (display) typeface = DISPLAY
    }

    /** A vertical column. */
    fun column() = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }

    private fun fullWidth(top: Int = 0) =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = top }

    /** A rounded card; its rows go in the returned column. */
    fun card(parent: ViewGroup, color: Int = CARD, border: Int? = null): LinearLayout {
        val card = column().apply {
            setPadding(pad, pad * 7 / 8, pad, pad * 7 / 8)
            background = rounded(color, 18, border)
            // Rows that appear or go (steps, Advanced) slide in.
            layoutTransition = android.animation.LayoutTransition()
        }
        parent.addView(card, fullWidth(dp(12)))
        return card
    }

    /** A small heading above a group of cards. */
    fun section(parent: ViewGroup, title: String) =
        parent.addView(text(title, 13f, MUTED, bold = true).apply { setPadding(dp(4), dp(20), 0, 0) })

    /** A full-width button: accent, or quiet. */
    fun button(parent: ViewGroup, label: String, color: Int = ACCENT, textColor: Int = Color.WHITE, onClick: () -> Unit) =
        text(label, 15f, textColor, bold = true).apply {
            gravity = Gravity.CENTER
            setPadding(pad, dp(12), pad, dp(12))
            background = rounded(color, 12)
            setOnClickListener { onClick() }
            pressable()
            parent.addView(this, fullWidth(dp(10)))
        }

    /** A setting that is on or off, with an optional line explaining it. */
    fun switchRow(parent: ViewGroup, title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit): Switch {
        val row = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(10), 0, dp(10))
        }
        val words = column()
        words.addView(text(title, 15f))
        subtitle?.let { words.addView(text(it, 13f, MUTED)) }
        row.addView(words, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val switch = Switch(context).apply {
            isChecked = checked
            setOnCheckedChangeListener { _, on -> onChange(on) }
        }
        row.addView(switch)
        // The whole row toggles it, not only the small switch.
        row.setOnClickListener { switch.toggle() }
        parent.addView(row, fullWidth())
        return switch
    }

    /**
     * A choice of a few options, the selected one on a pill that slides to the
     * next choice. `selected` -1: none (the value is a custom one). Returns a
     * setter, for when the value changes elsewhere (it doesn't call onSelect).
     */
    fun segmented(parent: ViewGroup, labels: List<String>, selected: Int, onSelect: (Int) -> Unit): (Int) -> Unit {
        val frame = FrameLayout(context).apply {
            background = rounded(INK, 12)
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }
        val pill = View(context).apply { background = rounded(ACCENT, 10) }
        val row = LinearLayout(context)
        val options = labels.map { label ->
            text(label, 14f, MUTED, bold = true).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(9), 0, dp(9))
            }
        }
        options.forEach { row.addView(it, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)) }
        frame.addView(pill, FrameLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT))
        frame.addView(row, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        var current = selected
        fun place(animate: Boolean) {
            options.forEachIndexed { i, option -> option.setTextColor(if (i == current) Color.WHITE else MUTED) }
            if (current < 0) {
                pill.visibility = View.INVISIBLE
                return
            }
            val target = options[current]
            if (pill.layoutParams.width != target.width) pill.layoutParams = pill.layoutParams.apply { width = target.width }
            pill.visibility = View.VISIBLE
            if (animate) {
                pill.animate().translationX(target.left.toFloat()).setDuration(260).setInterpolator(OvershootInterpolator(0.9f))
            } else {
                pill.translationX = target.left.toFloat()
            }
        }
        options.forEachIndexed { i, option ->
            option.setOnClickListener {
                if (i == current) return@setOnClickListener
                current = i
                place(animate = true)
                onSelect(i)
            }
        }
        row.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> place(animate = false) }
        parent.addView(frame, fullWidth(dp(6)))
        return { i ->
            if (i != current) {
                current = i
                place(animate = true)
            }
        }
    }

    /** Rows shown only while a switch above them is on; they slide in and out with the card. */
    fun dependent(parent: ViewGroup, shown: Boolean): LinearLayout =
        column().apply {
            visibility = if (shown) View.VISIBLE else View.GONE
            parent.addView(this, fullWidth())
        }

    /** A number set on a slider, its value shown in the caption (and passed to onMove while it moves). */
    fun slider(
        parent: ViewGroup, caption: (Int) -> String, min: Int, max: Int, step: Int, value: Int,
        onMove: (Int) -> Unit = {}, onChange: (Int) -> Unit,
    ): SeekBar {
        val label = text(caption(value), 14f).apply { setPadding(0, dp(12), 0, 0) }
        parent.addView(label)
        return SeekBar(context).apply {
            this.max = (max - min) / step
            progress = (value - min) / step
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
                    label.text = caption(min + progress * step)
                    if (fromUser) onMove(min + progress * step)
                }
                override fun onStartTrackingTouch(bar: SeekBar) {}
                override fun onStopTrackingTouch(bar: SeekBar) = onChange(min + bar.progress * step)
            })
            parent.addView(this, fullWidth(dp(4)))
        }
    }

    /** The screen's cards come in one after another, rising a little. */
    fun enter(views: List<View>) {
        views.forEachIndexed { i, view ->
            view.alpha = 0f
            view.translationY = dp(18).toFloat()
            view.animate().alpha(1f).translationY(0f).setStartDelay(45L * i).setDuration(360)
                .setInterpolator(DecelerateInterpolator(2f))
        }
    }

    /** A plain row in a list (no card): a symbol, a title and a line under it, darkening under the finger. */
    fun listRow(parent: ViewGroup, symbol: String, symbolColor: Int, title: String, onClick: () -> Unit): TextView {
        val row = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(16), dp(4), dp(16))
            background = android.graphics.drawable.StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_pressed), rounded(CARD, 14))
            }
            setOnClickListener { onClick() }
        }
        row.addView(text(symbol, 20f, symbolColor).apply {
            gravity = Gravity.CENTER
            minWidth = dp(40)
        })
        val words = column().apply { setPadding(dp(10), 0, 0, 0) }
        words.addView(text(title, 17f, bold = true))
        val subtitle = text("", 13f, MUTED)
        words.addView(subtitle)
        row.addView(words, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(text("›", 26f, MUTED))
        parent.addView(row, fullWidth())
        return subtitle
    }

    /** A hairline between rows. */
    fun divider(parent: ViewGroup) =
        parent.addView(View(context).apply { setBackgroundColor(LINE) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))

    /** The settings gear, drawn: no icon font on Android. */
    fun gear(onClick: () -> Unit) = object : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = MUTED }
        override fun onDraw(canvas: Canvas) {
            val c = width / 2f
            val r = width * 0.3f
            for (i in 0 until 8) {
                canvas.save()
                canvas.rotate(i * 45f, c, c)
                canvas.drawRoundRect(c - width * 0.07f, c - r - width * 0.13f, c + width * 0.07f, c, width * 0.03f, width * 0.03f, paint)
                canvas.restore()
            }
            canvas.drawCircle(c, c, r, paint)
            paint.color = BG
            canvas.drawCircle(c, c, r * 0.45f, paint)
            paint.color = MUTED
        }
    }.apply {
        layoutParams = LinearLayout.LayoutParams(dp(26), dp(26))
        contentDescription = "Settings"
        setOnClickListener { onClick() }
        pressable()
    }

    companion object {
        // Night walnut and board shadow: Chess.com's dark board, at night.
        val BG = Color.parseColor("#1d1b19")
        val CARD = Color.parseColor("#2b2825")
        val INK = Color.parseColor("#161514")
        val LINE = Color.parseColor("#3d3934")
        /** Bone: text, and the white pieces. */
        val TEXT = Color.parseColor("#f2ede4")
        val MUTED = Color.parseColor("#a39c93")
        /** Brass: Vektra's mark and your results; blue (ACCENT) is the engine's. */
        val BRASS = Color.parseColor("#e3b341")
        /** Condensed type for titles and numbers, like a scoreboard (built into Android). */
        val DISPLAY: Typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
        val ACCENT = Color.parseColor("#2f6fe4")
        val LINK = Color.parseColor("#9dbcff")
        val WARN = Color.parseColor("#4a3a14")
        val WARN_BORDER = Color.parseColor("#6b5420")
        val WARN_TEXT = Color.parseColor("#f7d27a")
        val WARN_FILL = Color.parseColor("#f7c631")
        val WARN_ON = Color.parseColor("#3a2a00")
        /** Xiaomi's own system (MIUI, HyperOS) has its own Autostart and battery rules. */
        val XIAOMI = Build.MANUFACTURER.lowercase() in setOf("xiaomi", "redmi", "poco")
    }
}

/** Sinks a little under the finger, and springs back. */
@SuppressLint("ClickableViewAccessibility")
fun View.pressable() {
    setOnTouchListener { view, event ->
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> view.animate().scaleX(0.97f).scaleY(0.97f).setDuration(90).start()
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL ->
                view.animate().scaleX(1f).scaleY(1f).setDuration(220).setInterpolator(OvershootInterpolator(2f)).start()
        }
        false
    }
}
