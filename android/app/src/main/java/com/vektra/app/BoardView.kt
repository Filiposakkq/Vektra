package com.vektra.app

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.view.View
import android.view.animation.DecelerateInterpolator

/**
 * A chess board drawn natively: the squares, coordinates, the move just
 * played in yellow, and the cburnett pieces (drawable/piece_*.xml). Arrows
 * and rating badges go on top, in an OverlayView of the same size.
 */
class BoardView(context: Context) : View(context) {
    private var rows: List<String> = emptyList()
    private var flipped = false
    private var moved: Set<String> = emptySet()
    /** Coordinates along the edges (off for small boards). */
    var coordinates = true
    /** Corner radius, as a share of a square. */
    var corner = 0f

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL) }
    private val clip = Path()
    private val pieces = HashMap<Char, Drawable>()
    /** The piece gliding in: its square, and its offset in squares. */
    private var gliding: String? = null
    private var glideX = 0f
    private var glideY = 0f
    private var glide: ValueAnimator? = null

    /** Shows a position (a FEN), from Black's side if `flipped`, with the `moved` squares marked. */
    fun show(fen: String, flipped: Boolean, moved: Collection<String> = emptyList()) {
        rows = fen.substringBefore(' ').split('/').map { row -> row.replace(Regex("\\d")) { ".".repeat(it.value.toInt()) } }
        this.flipped = flipped
        this.moved = moved.toSet()
        invalidate()
    }

    /** The piece now on `to` glides there from `from`, as if just moved. */
    fun slide(from: String, to: String) {
        val (fx, fy) = cell(from)
        val (tx, ty) = cell(to)
        glide?.cancel()
        gliding = to
        glide = ValueAnimator.ofFloat(1f, 0f).apply {
            duration = 190
            interpolator = DecelerateInterpolator(2f)
            addUpdateListener {
                val t = it.animatedValue as Float
                glideX = (fx - tx) * t
                glideY = (fy - ty) * t
                invalidate()
            }
            start()
        }
    }

    /** A square's column and row on screen. */
    private fun cell(square: String): Pair<Int, Int> {
        val file = square[0] - 'a'
        val rank = square[1] - '0'
        return if (flipped) Pair(7 - file, rank - 1) else Pair(file, 8 - rank)
    }

    private fun piece(c: Char): Drawable = pieces.getOrPut(c) { context.getDrawable(PIECES.getValue(c))!! }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = MeasureSpec.getSize(widthMeasureSpec)
        setMeasuredDimension(size, size)
    }

    override fun onDraw(canvas: Canvas) {
        if (rows.size != 8) return
        val size = width / 8f
        canvas.save()
        if (corner > 0f) {
            clip.reset()
            clip.addRoundRect(RectF(0f, 0f, width.toFloat(), height.toFloat()), size * corner, size * corner, Path.Direction.CW)
            canvas.clipPath(clip)
        }
        label.textSize = size * 0.2f
        for (r in 0 until 8) for (c in 0 until 8) {
            val file = if (flipped) 7 - c else c
            val rank = if (flipped) r + 1 else 8 - r
            val light = (file + rank) % 2 == 0
            val left = c * size
            val top = r * size
            fill.color = if (light) LIGHT else DARK
            canvas.drawRect(left, top, left + size, top + size, fill)
            if ("${'a' + file}$rank" in moved) {
                fill.color = MOVED
                canvas.drawRect(left, top, left + size, top + size, fill)
            }
            if (coordinates) {
                label.color = if (light) DARK else LIGHT
                if (c == 0) canvas.drawText("$rank", left + size * 0.06f, top + size * 0.24f, label)
                if (r == 7) canvas.drawText("${'a' + file}", left + size * 0.8f, top + size * 0.94f, label)
            }
        }
        for (r in 0 until 8) for (c in 0 until 8) {
            val file = if (flipped) 7 - c else c
            val rank = if (flipped) r + 1 else 8 - r
            val p = rows[8 - rank][file]
            if (p == '.') continue
            val glides = gliding == "${'a' + file}$rank"
            val left = (c + if (glides) glideX else 0f) * size
            val top = (r + if (glides) glideY else 0f) * size
            val inset = size * 0.04f
            piece(p).apply {
                setBounds((left + inset).toInt(), (top + inset).toInt(), (left + size - inset).toInt(), (top + size - inset).toInt())
                draw(canvas)
            }
        }
        canvas.restore()
    }

    override fun onDetachedFromWindow() {
        glide?.cancel()
        super.onDetachedFromWindow()
    }

    private companion object {
        val LIGHT = Color.parseColor("#ebd9bd")
        val DARK = Color.parseColor("#a5805e")
        /** Chess.com's yellow, over either square colour. */
        val MOVED = Color.argb(128, 255, 221, 51)
        /** FEN letters to their drawings (upper case is White). */
        val PIECES = mapOf(
            'K' to R.drawable.piece_wk, 'Q' to R.drawable.piece_wq, 'R' to R.drawable.piece_wr,
            'B' to R.drawable.piece_wb, 'N' to R.drawable.piece_wn, 'P' to R.drawable.piece_wp,
            'k' to R.drawable.piece_bk, 'q' to R.drawable.piece_bq, 'r' to R.drawable.piece_br,
            'b' to R.drawable.piece_bb, 'n' to R.drawable.piece_bn, 'p' to R.drawable.piece_bp,
        )
    }
}
