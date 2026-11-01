package com.vektra.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import kotlin.math.roundToInt

/**
 * A see-through window laid exactly over the Chess.com board, with a thin eval
 * strip above it. It holds the overlay page (android/web), which runs
 * Stockfish and the shared hint code and draws the arrows. Touches go
 * straight through to Chess.com; the window can't be tapped or focused.
 */
class HintOverlay(private val context: Context) {
    private val windowManager = context.getSystemService(WindowManager::class.java)
    private val stripPx = (EVAL_STRIP_DP * context.resources.displayMetrics.density).roundToInt()
    private var web: WebView? = null
    private val params = WindowManager.LayoutParams(
        1,
        1,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }
    private var pageReady = false
    /** The latest call, made once the page has loaded. */
    private var pending: String? = null

    fun show(reading: GameReading) {
        val view = web ?: create()
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
        val turn = reading.moves.sideToMove?.let { "\"$it\"" } ?: "null"
        call("vektra.show({board:\"${reading.board.placement}\",turn:$turn,flipped:${reading.board.flipped}})")
    }

    /** Clears the arrows and hides the window; the engine stays loaded for the next bot game. */
    fun hide() {
        val view = web ?: return
        call("vektra.clear()")
        view.visibility = View.GONE
    }

    fun destroy() {
        web?.let {
            windowManager.removeView(it)
            it.destroy()
        }
        web = null
        pageReady = false
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun create(): WebView {
        // Serves the app's assets over https, so the engine's worker and wasm load like on a web page.
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
        val view = WebView(context).apply {
            setBackgroundColor(Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                override fun onPageFinished(view: WebView, url: String) {
                    pageReady = true
                    pending?.let { view.evaluateJavascript(it, null) }
                    pending = null
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.i(TAG, "overlay: ${message.message()}")
                    return true
                }
            }
            visibility = View.GONE
        }
        windowManager.addView(view, params)
        view.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
        web = view
        return view
    }

    private fun call(script: String) {
        val view = web ?: return
        if (pageReady) view.evaluateJavascript(script, null) else pending = script
    }

    /** The board's area on screen: from its top-left square to its bottom-right one. */
    private fun boardRect(board: BoardReading): Rect {
        val squares = board.squares.values
        return Rect(squares.minOf { it.left }, squares.minOf { it.top }, squares.maxOf { it.right }, squares.maxOf { it.bottom })
    }

    private companion object {
        const val TAG = "Vektra"
        /** Height of the eval strip above the board (8 CSS pixels in the page). */
        const val EVAL_STRIP_DP = 8f
    }
}
