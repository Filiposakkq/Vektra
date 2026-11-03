package com.vektra.app

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView

/**
 * Vektra's look on Android, shared by every screen: a deep night palette,
 * gold from the logo for Vektra's main actions and your results, the
 * engine's blue for arrows and what is active, big rounded surfaces, pill
 * buttons, bold headlines, and Android's ripple under the finger.
 */
class Ui(private val context: Context) {
    val pad = dp(20)

    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()

    fun rounded(color: Int, radiusDp: Int, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp).toFloat()
        stroke?.let { setStroke(dp(1), it) }
    }

    /** A surface that ripples under the finger. */
    fun ripple(content: Drawable, radiusDp: Int) =
        RippleDrawable(ColorStateList.valueOf(Color.argb(40, 255, 255, 255)), content, rounded(Color.WHITE, radiusDp))

    fun text(value: CharSequence, size: Float = 15f, color: Int = TEXT, weight: Weight = Weight.REGULAR) = TextView(context).apply {
        text = value
        textSize = size
        setTextColor(color)
        typeface = weight.typeface
        if (weight == Weight.HEADLINE) letterSpacing = -0.02f
    }

    enum class Weight(val typeface: Typeface) {
        REGULAR(Typeface.create("sans-serif", Typeface.NORMAL)),
        MEDIUM(Typeface.create("sans-serif-medium", Typeface.NORMAL)),
        /** Big titles: Roboto at its heaviest, tightly set. */
        HEADLINE(Typeface.create("sans-serif-black", Typeface.NORMAL)),
        /** Numbers, like a scoreboard. */
        NUMBER(Typeface.create("sans-serif-condensed", Typeface.BOLD)),
    }

    fun column() = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }

    fun row() = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }

    fun fullWidth(top: Int = 0) =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = top }

    fun weighted() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)

    /** A vector icon (drawable/ic_*), tinted. */
    fun icon(res: Int, color: Int, sizeDp: Int = 24) = ImageView(context).apply {
        setImageResource(res)
        imageTintList = ColorStateList.valueOf(color)
        layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
    }

    /** A screen's big title. */
    fun screenTitle(parent: ViewGroup, title: String) =
        parent.addView(text(title, 32f, weight = Weight.HEADLINE).apply { setPadding(0, dp(8), 0, dp(4)) })

    /** A small heading above a group. */
    fun section(parent: ViewGroup, title: String) =
        parent.addView(text(title, 14f, MUTED, Weight.MEDIUM).apply { setPadding(dp(4), dp(26), 0, dp(10)) })

    /** A rounded surface; its rows go in the returned column. */
    fun card(parent: ViewGroup, color: Int = SURFACE, border: Int? = null, top: Int = 0): LinearLayout {
        val card = column().apply {
            setPadding(dp(18), dp(16), dp(18), dp(16))
            background = rounded(color, 24, border)
            layoutTransition = android.animation.LayoutTransition()
        }
        parent.addView(card, fullWidth(top))
        return card
    }

    /** A pill button: gold (Vektra's main action), blue (the engine's) or quiet. */
    fun button(parent: ViewGroup, label: String, style: Button = Button.QUIET, onClick: () -> Unit) =
        text(label, 16f, style.text, Weight.MEDIUM).apply {
            gravity = Gravity.CENTER
            minHeight = dp(52)
            setPadding(dp(20), dp(14), dp(20), dp(14))
            background = ripple(rounded(style.fill, 26), 26)
            setOnClickListener { onClick() }
            pressable()
            parent.addView(this, fullWidth(dp(12)))
        }

    enum class Button(val fill: Int, val text: Int) {
        GOLD(Ui.GOLD, Color.parseColor("#241a05")),
        ENGINE(Ui.ACCENT, Color.WHITE),
        QUIET(Ui.SURFACE_HIGH, Ui.TEXT),
        WARN(Ui.WARN_FILL, Ui.WARN_ON),
    }

    /** A setting that is on or off, with an optional line explaining it. */
    fun switchRow(parent: ViewGroup, title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit): Switch {
        val row = row().apply { setPadding(0, dp(12), 0, dp(12)) }
        val words = column()
        words.addView(text(title, 16f))
        subtitle?.let { words.addView(text(it, 13f, MUTED).apply { setPadding(0, dp(2), 0, 0) }) }
        row.addView(words, weighted())
        val switch = Switch(context).apply {
            isChecked = checked
            thumbTintList = ColorStateList(arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()), intArrayOf(Color.WHITE, MUTED))
            trackTintList = ColorStateList(arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()), intArrayOf(ACCENT, LINE))
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
            background = rounded(BG, 22)
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        val pill = View(context).apply { background = rounded(ACCENT, 18) }
        val row = LinearLayout(context)
        val options = labels.map { label ->
            text(label, 14f, MUTED, Weight.MEDIUM).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(10), 0, dp(10))
            }
        }
        options.forEach { row.addView(it, weighted()) }
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
                pill.animate().translationX(target.left.toFloat()).setDuration(280).setInterpolator(OvershootInterpolator(0.9f))
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
        parent.addView(frame, fullWidth(dp(8)))
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
        val label = text(caption(value), 15f).apply { setPadding(0, dp(14), 0, 0) }
        parent.addView(label)
        return SeekBar(context).apply {
            this.max = (max - min) / step
            progress = (value - min) / step
            progressTintList = ColorStateList.valueOf(ACCENT)
            thumbTintList = ColorStateList.valueOf(Color.WHITE)
            progressBackgroundTintList = ColorStateList.valueOf(LINE)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
                    label.text = caption(min + progress * step)
                    if (fromUser) onMove(min + progress * step)
                }
                override fun onStartTrackingTouch(bar: SeekBar) {}
                override fun onStopTrackingTouch(bar: SeekBar) = onChange(min + bar.progress * step)
            })
            parent.addView(this, fullWidth(dp(6)))
        }
    }

    /**
     * A row to tap: an icon on a tinted tile, a title, a line under it and a
     * chevron. Returns the line under the title, to fill in.
     */
    fun linkRow(parent: ViewGroup, iconRes: Int, tint: Int, title: String, onClick: () -> Unit): TextView {
        val row = row().apply {
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = ripple(rounded(SURFACE, 22), 22)
            setOnClickListener { onClick() }
        }
        val tile = FrameLayout(context).apply { background = rounded(Color.argb(38, Color.red(tint), Color.green(tint), Color.blue(tint)), 14) }
        tile.addView(icon(iconRes, tint, 22), FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
        row.addView(tile, LinearLayout.LayoutParams(dp(44), dp(44)))
        val words = column().apply { setPadding(dp(14), 0, dp(8), 0) }
        words.addView(text(title, 16f, weight = Weight.MEDIUM))
        val subtitle = text("", 13f, MUTED).apply { setPadding(0, dp(2), 0, 0) }
        words.addView(subtitle)
        row.addView(words, weighted())
        row.addView(icon(R.drawable.ic_chevron, MUTED, 20))
        parent.addView(row, fullWidth(dp(10)))
        return subtitle
    }

    /** Something appearing: it rises in a little (an update, a result). */
    fun enter(view: View) {
        view.alpha = 0f
        view.translationY = dp(14).toFloat()
        view.animate().alpha(1f).translationY(0f).setDuration(320).setInterpolator(DecelerateInterpolator(2f))
    }

    companion object {
        val BG = Color.parseColor("#121110")
        val SURFACE = Color.parseColor("#1c1a18")
        val SURFACE_HIGH = Color.parseColor("#292622")
        val LINE = Color.parseColor("#3a3530")
        val TEXT = Color.parseColor("#f4efe6")
        val MUTED = Color.parseColor("#9d968c")
        /** Gold from the logo: Vektra's main actions and your results. */
        val GOLD = Color.parseColor("#f0b93a")
        /** The engine's blue: arrows, and what is active. */
        val ACCENT = Color.parseColor("#2f6fe4")
        val LINK = Color.parseColor("#9dbcff")
        val GOOD = Color.parseColor("#7fc25a")
        val WARN_TEXT = Color.parseColor("#f7d27a")
        val WARN_BORDER = Color.parseColor("#6b5420")
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
