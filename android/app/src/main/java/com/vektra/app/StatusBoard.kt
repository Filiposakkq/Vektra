package com.vektra.app

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.RectF
import android.view.View
import android.view.animation.DecelerateInterpolator

/**
 * The home screen's status, as a corner of a board: Vektra's knight, and
 * when it is ready, its blue hint arrow drawing itself across the squares
 * (a knight's move, as Vektra draws them in games). When something needs
 * fixing the board dims and the arrow stays away.
 */
class StatusBoard(context: Context) : View(context) {
    /** Hints will show: the arrow is drawn. */
    var ready = true
        set(value) {
            field = value
            if (!value) progress = 0f
            invalidate()
        }

    private val knight = context.getDrawable(R.drawable.vektra_knight)!!
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = Ui.ACCENT
    }
    private val clip = Path()
    private val arrow = Path()
    private val drawn = Path()
    private val head = Path()
    private var progress = 0f
    private var animator: ValueAnimator? = null

    /** Draws the arrow in, once (when the screen opens and Vektra is ready). */
    fun play() {
        animator?.cancel()
        if (!ready) return
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 900
            startDelay = 250
            interpolator = DecelerateInterpolator(1.6f)
            addUpdateListener {
                progress = it.animatedValue as Float
                invalidate()
            }
            start()
        }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = MeasureSpec.getSize(widthMeasureSpec)
        setMeasuredDimension(size, size)
    }

    override fun onDraw(canvas: Canvas) {
        val cell = width / 4f
        clip.reset()
        clip.addRoundRect(RectF(0f, 0f, width.toFloat(), height.toFloat()), cell * 0.4f, cell * 0.4f, Path.Direction.CW)
        canvas.save()
        canvas.clipPath(clip)
        for (row in 0 until 4) for (col in 0 until 4) {
            fill.color = if ((row + col) % 2 == 0) LIGHT else DARK
            canvas.drawRect(col * cell, row * cell, (col + 1) * cell, (row + 1) * cell, fill)
        }
        // The knight on the bottom-left square, and its move: two up, one right.
        val inset = (cell * 0.06f).toInt()
        knight.setBounds(inset, (3 * cell).toInt() + inset, cell.toInt() - inset, (4 * cell).toInt() - inset)
        knight.draw(canvas)
        if (ready && progress > 0f) {
            arrow.reset()
            arrow.moveTo(cell * 0.5f, cell * 3.2f)
            arrow.lineTo(cell * 0.5f, cell * 1.5f)
            arrow.lineTo(cell * 1.3f, cell * 1.5f)
            val measure = PathMeasure(arrow, false)
            drawn.reset()
            measure.getSegment(0f, measure.length * progress, drawn, true)
            stroke.strokeWidth = cell * 0.17f
            canvas.drawPath(drawn, stroke)
            // The head arrives with the end of the line.
            if (progress > 0.75f) {
                fill.color = Ui.ACCENT
                fill.alpha = (255 * (progress - 0.75f) / 0.25f).toInt()
                head.reset()
                head.moveTo(cell * 1.72f, cell * 1.5f)
                head.lineTo(cell * 1.22f, cell * 1.18f)
                head.lineTo(cell * 1.22f, cell * 1.82f)
                head.close()
                canvas.drawPath(head, fill)
                fill.alpha = 255
            }
        }
        // Not ready: the board dims.
        if (!ready) canvas.drawColor(Color.argb(150, 29, 27, 25))
        canvas.restore()
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        super.onDetachedFromWindow()
    }

    private companion object {
        // The review board's squares (android/web/review.html).
        val LIGHT = Color.parseColor("#ebd9bd")
        val DARK = Color.parseColor("#a5805e")
    }
}
