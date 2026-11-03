package com.vektra.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.util.Log
import android.view.View
import org.json.JSONArray
import org.json.JSONObject

/**
 * Paints what the overlay page worked out (android/web/nativeLayer.ts, from
 * core/draw/arrowDrawing.ts): the arrows, score pills, rating icon and eval
 * strip, with Android's own graphics. The extension draws the same
 * description as SVG, so both look alike. The view covers the board, with
 * the eval strip in the `stripPx` above it.
 */
class OverlayView(context: Context, private val stripPx: Int) : View(context) {
    private var frame: JSONObject? = null

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        typeface = Typeface.DEFAULT_BOLD
    }
    private val path = Path()
    /** Pixels per board unit (one square), set on each draw. */
    private var unit = 1f
    private val rect = RectF()

    /** A new frame from the page (JSON); drawn on the next screen refresh. */
    fun show(json: String) {
        frame = JSONObject(json)
        invalidate()
    }

    /** The user has moved: their arrows go at once, before the page sends the next frame. */
    fun clearArrows() {
        val f = frame ?: return
        f.put("arrows", JSONArray())
        invalidate()
    }

    fun clear() {
        frame = null
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val f = frame ?: return
        // A frame that can't be painted is skipped: a crash here would stop the
        // whole accessibility service, and Android won't restart it by itself.
        try {
            paint(canvas, f)
        } catch (e: Exception) {
            Log.e("Vektra", "could not paint a frame", e)
            frame = null
        }
    }

    private fun paint(canvas: Canvas, f: JSONObject) {
        f.optJSONObject("eval")?.let { drawEval(canvas, it) }
        // Board units (a square is 1) to pixels, below the eval strip.
        unit = width / 8f
        canvas.save()
        canvas.translate(0f, stripPx.toFloat())
        canvas.scale(unit, unit)
        val arrows = f.optJSONArray("arrows") ?: JSONArray()
        // The best move's squares, lightly: this layer is above the pieces.
        for (i in 0 until arrows.length()) {
            val tint = arrows.getJSONObject(i).optJSONArray("tint") ?: continue
            val color = color(arrows.getJSONObject(i).getString("color"))
            for ((index, alpha) in listOf(0.2f, 0.28f).withIndex()) {
                val square = tint.getJSONArray(index)
                fill.color = withAlpha(color, alpha)
                canvas.drawRect(
                    square.getDouble(0).toFloat() - 0.5f, square.getDouble(1).toFloat() - 0.5f,
                    square.getDouble(0).toFloat() + 0.5f, square.getDouble(1).toFloat() + 0.5f, fill,
                )
            }
        }
        // Already in drawing order: threats first, the best move last.
        for (i in 0 until arrows.length()) drawArrow(canvas, arrows.getJSONObject(i))
        // Score pills last, so no arrow covers one; the best move's in front.
        val labelled = (0 until arrows.length()).map { arrows.getJSONObject(it) }
            .filter { it.optJSONObject("label") != null }
            .sortedBy { it.getInt("rank") }
        for (arrow in labelled) {
            val label = arrow.getJSONObject("label")
            canvas.saveLayerAlpha(null, (label.getDouble("opacity") * 255).toInt())
            drawBox(canvas, label, outline = INK)
            canvas.restore()
        }
        f.optJSONObject("badge")?.let { drawBadge(canvas, it) }
        canvas.restore()
    }

    private fun drawArrow(canvas: Canvas, a: JSONObject) {
        val color = color(a.getString("color"))
        val width = a.getDouble("width").toFloat()
        // One opacity for the whole arrow, so its parts don't show through each other.
        canvas.saveLayerAlpha(null, (a.getDouble("opacity") * 255).toInt())
        val dash = a.optJSONArray("dash")?.let { floatArrayOf(it.getDouble(0).toFloat(), it.getDouble(1).toFloat()) }
        val shaft = points(a.getJSONArray("shaft"))
        val head = points(a.getJSONArray("head"))
        // A dark edge under the arrow keeps it readable on light squares and white pieces.
        stroke.color = withAlpha(INK, 0.4f)
        stroke.strokeWidth = width + 0.035f
        stroke.pathEffect = dash?.let { DashPathEffect(it, 0f) }
        canvas.drawPath(line(shaft), stroke)
        fill.color = withAlpha(INK, 0.4f)
        canvas.drawPath(polygon(head), fill)
        stroke.strokeWidth = width * 0.15f + 0.035f
        stroke.pathEffect = null
        canvas.drawPath(polygon(head), stroke)
        // The arrow itself: dashed while the engine may still change its mind.
        stroke.color = color
        stroke.strokeWidth = width
        stroke.pathEffect = dash?.let { DashPathEffect(it, 0f) }
        canvas.drawPath(line(shaft), stroke)
        stroke.pathEffect = null
        fill.color = color
        canvas.drawPath(polygon(head), fill)
        stroke.strokeWidth = width * 0.15f
        canvas.drawPath(polygon(head), stroke)
        a.optJSONObject("promotion")?.let { drawBox(canvas, it, outline = Color.WHITE) }
        a.optJSONObject("step")?.let { step ->
            val cx = step.getDouble("cx").toFloat()
            val cy = step.getDouble("cy").toFloat()
            val r = step.getDouble("radius").toFloat()
            fill.color = color(step.getString("fill"))
            canvas.drawCircle(cx, cy, r, fill)
            drawText(canvas, step.getString("text"), cx, cy, color(step.getString("textColor")))
        }
        canvas.restore()
    }

    /** A rounded box with centred text: a score pill or a promotion tile. */
    private fun drawBox(canvas: Canvas, box: JSONObject, outline: Int) {
        val x = box.getDouble("x").toFloat()
        val y = box.getDouble("y").toFloat()
        val w = box.getDouble("width").toFloat()
        val h = box.getDouble("height").toFloat()
        val r = box.getDouble("radius").toFloat()
        rect.set(x, y, x + w, y + h)
        fill.color = color(box.getString("fill"))
        canvas.drawRoundRect(rect, r, r, fill)
        stroke.color = withAlpha(outline, if (outline == INK) 0.35f else 1f)
        stroke.strokeWidth = 0.015f
        canvas.drawRoundRect(rect, r, r, stroke)
        drawText(canvas, box.getString("text"), x + w / 2, y + h / 2, color(box.getString("textColor")))
    }

    /** A move rating: a round icon in the category's colour with its symbol. */
    private fun drawBadge(canvas: Canvas, badge: JSONObject) {
        val cx = badge.getDouble("cx").toFloat()
        val cy = badge.getDouble("cy").toFloat()
        val r = badge.getDouble("radius").toFloat()
        fill.color = color(badge.getString("color"))
        canvas.drawCircle(cx, cy, r, fill)
        stroke.color = Color.WHITE
        stroke.strokeWidth = 0.03f
        canvas.drawCircle(cx, cy, r, stroke)
        drawText(canvas, badge.getString("symbol"), cx, cy, Color.WHITE, size = r * 1.05f)
    }

    /** The eval strip: the user's share of the win chance on the left, outlined for dark backgrounds. */
    private fun drawEval(canvas: Canvas, e: JSONObject) {
        val h = stripPx.toFloat()
        val mine = e.getDouble("mine").toFloat().coerceIn(0f, 1f)
        val split = width * mine
        fill.color = withAlpha(color(e.getString("mineColor")), 0.9f)
        canvas.drawRect(0f, 0f, split, h, fill)
        fill.color = withAlpha(color(e.getString("theirsColor")), 0.9f)
        canvas.drawRect(split, 0f, width.toFloat(), h, fill)
        stroke.color = withAlpha(Color.WHITE, 0.55f)
        stroke.strokeWidth = resources.displayMetrics.density
        rect.set(0.5f, 0.5f, width - 0.5f, h - 0.5f)
        canvas.drawRoundRect(rect, h / 4, h / 4, stroke)
    }

    private fun drawText(canvas: Canvas, s: String, cx: Float, cy: Float, color: Int, size: Float = 0.2f) {
        text.color = color
        // In pixels, not board units: fonts look wrong when drawn tiny and scaled up.
        text.textSize = size * unit
        canvas.save()
        canvas.scale(1 / unit, 1 / unit)
        // Centred vertically on the box, like SVG's dominant-baseline: central.
        canvas.drawText(s, cx * unit, cy * unit - (text.ascent() + text.descent()) / 2, text)
        canvas.restore()
    }

    private fun points(a: JSONArray): List<Pair<Float, Float>> =
        (0 until a.length()).map { a.getJSONArray(it).let { p -> p.getDouble(0).toFloat() to p.getDouble(1).toFloat() } }

    private fun line(points: List<Pair<Float, Float>>): Path = path.apply {
        reset()
        points.forEachIndexed { i, (x, y) -> if (i == 0) moveTo(x, y) else lineTo(x, y) }
    }

    private fun polygon(points: List<Pair<Float, Float>>): Path = line(points).apply { close() }

    /** A CSS colour: "#rrggbb", or the short "#rgb" the shared code also uses. */
    private fun color(hex: String): Int =
        Color.parseColor(if (hex.length == 4) "#" + hex.drop(1).map { "$it$it" }.joinToString("") else hex)

    private fun withAlpha(color: Int, alpha: Float): Int = Color.argb((alpha * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color))

    private companion object {
        /** Dark text and arrow edges (BOARD_COLORS.ink in core/hints/arrowShapes.ts). */
        val INK = Color.parseColor("#14202c")
    }
}
