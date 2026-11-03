package com.vektra.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import kotlin.math.roundToInt

/**
 * A see-through window laid exactly over the Chess.com board, with a thin eval
 * strip above it. The overlay page (android/web) runs Stockfish and the
 * shared hint code in a hidden WebView and hands over what to draw; an
 * OverlayView paints it natively. Touches go straight through to Chess.com;
 * the window can't be tapped or focused.
 */
class HintOverlay(private val context: Context) {
    private val windowManager = context.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private val stripPx = (EVAL_STRIP_DP * context.resources.displayMetrics.density).roundToInt()
    private var root: FrameLayout? = null
    private var web: WebView? = null
    private var painter: OverlayView? = null
    private val params = WindowManager.LayoutParams(
        1,
        1,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            // Windows a service adds are drawn by the CPU unless asked.
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
        PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }
    private var pageReady = false
    /** Calls made before the page loaded, run once it has. */
    private val pending = ArrayList<String>()
    /** The side the user plays: the one at the bottom of the board. */
    private var userColor = 'w'
    /** Who moves next, as far as the app can tell (the page knows for sure). */
    private var nextMover: Char? = null
    /** The user's settings, sent again whenever the page (re)loads. */
    private var settingsJson = SettingsStore.load(context).toJson()

    fun show(reading: GameReading) {
        val view = root ?: create()
        val board = boardRect(reading.board)
        val x = board.left
        val y = board.top - stripPx
        val w = board.width()
        val h = board.height() + stripPx
        if (params.x != x || params.y != y || params.width != w || params.height != h || view.visibility != View.VISIBLE) {
            params.x = x
            params.y = y
            params.width = w
            params.height = h
            view.visibility = View.VISIBLE
            windowManager.updateViewLayout(view, params)
        }
        userColor = if (reading.board.flipped) 'b' else 'w'
        reading.moves.sideToMove?.let { nextMover = it }
        val turn = reading.moves.sideToMove?.let { "\"$it\"" } ?: "null"
        call("vektra.show({board:\"${reading.board.placement}\",turn:$turn,flipped:${reading.board.flipped}})")
    }

    /** A move Chess.com announced: the page applies it to the position it shows, before the board is read. */
    fun played(move: MoveAnnouncement) {
        // The user's own move: their arrows are out of date this instant.
        // A capture names no colour: it is whoever is due to move.
        val mover = move.color ?: nextMover
        if (mover == userColor) painter?.clearArrows()
        nextMover = mover?.let { if (it == 'w') 'b' else 'w' }
        val squares = move.squares.joinToString(",") { "\"$it\"" }
        val color = move.color?.let { "\"$it\"" } ?: "null"
        call("vektra.played({squares:[$squares],color:$color,piece:\"${move.piece}\"})")
    }

    /** Sends the user's settings to the page; the shown hints are worked out again. */
    fun applySettings(settings: HintSettings) {
        settingsJson = settings.toJson()
        call("vektra.settings($settingsJson)")
    }

    /** Clears the arrows and hides the window; the engine stays loaded for the next bot game. */
    fun hide() {
        val view = root ?: return
        call("vektra.clear()")
        painter?.clear()
        view.visibility = View.GONE
    }

    fun destroy() {
        root?.let { windowManager.removeView(it) }
        web?.destroy()
        root = null
        web = null
        painter = null
        pageReady = false
    }

    /** The page's way to hand over a frame to paint (nativeLayer.ts calls it). */
    private inner class Bridge {
        @JavascriptInterface
        fun render(frame: String) {
            handler.post { painter?.show(frame) }
        }

        /** The bot game so far, kept for "Review your last bot game". */
        @JavascriptInterface
        fun game(json: String) = LastGame.save(context, json)
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun create(): FrameLayout {
        // Serves the app's assets over https, so the engine's worker and wasm load like on a web page.
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
        val webView = WebView(context).apply {
            setBackgroundColor(Color.TRANSPARENT)
            // It draws nothing: the page only works out what OverlayView paints.
            alpha = 0f
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            addJavascriptInterface(Bridge(), "VektraNative")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                override fun onPageFinished(view: WebView, url: String) {
                    pageReady = true
                    view.evaluateJavascript("vektra.settings($settingsJson)", null)
                    pending.forEach { view.evaluateJavascript(it, null) }
                    pending.clear()
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.i(TAG, "overlay: ${message.message()}")
                    return true
                }
            }
        }
        val overlay = OverlayView(context, stripPx)
        val frame = FrameLayout(context).apply {
            addView(webView, FrameLayout.LayoutParams(1, 1))
            addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            visibility = View.GONE
        }
        windowManager.addView(frame, params)
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
        root = frame
        web = webView
        painter = overlay
        return frame
    }

    private fun call(script: String) {
        val view = web ?: return
        if (pageReady) view.evaluateJavascript(script, null) else pending += script
    }

    /** The board's area on screen: from its top-left square to its bottom-right one. */
    private fun boardRect(board: BoardReading): Rect {
        val squares = board.squares.values
        return Rect(squares.minOf { it.left }, squares.minOf { it.top }, squares.maxOf { it.right }, squares.maxOf { it.bottom })
    }

    private companion object {
        const val TAG = "Vektra"
        /** Height of the eval strip above the board. */
        const val EVAL_STRIP_DP = 8f
    }
}
