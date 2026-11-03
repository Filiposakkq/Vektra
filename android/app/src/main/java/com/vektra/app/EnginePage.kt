package com.vektra.app

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * The hidden engine page (android/web/engine.ts) behind the app's native
 * screens: it reads games, names openings, analyses with Stockfish and works
 * out the review board's arrows, like the hint overlay's page does in games.
 * Calls are queued until the page is ready; answers come back on the main thread.
 */
@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
class EnginePage(context: Context, parent: ViewGroup) {
    private val handler = Handler(Looper.getMainLooper())
    private val waiting = HashMap<Int, (JSONObject) -> Unit>()
    private var nextId = 1
    private var ready = false
    private val queued = mutableListOf<String>()
    /** Analysis progress: positions done, of all. */
    var onProgress: ((Int, Int) -> Unit)? = null
    /** A frame of arrows and badge for the review board (OverlayView.show). */
    var onFrame: ((String) -> Unit)? = null

    private val webView = WebView(context).apply {
        alpha = 0f
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
        addJavascriptInterface(Engine(), "VektraEngine")
        addJavascriptInterface(Painter(), "VektraNative")
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            override fun onPageFinished(view: WebView, url: String) {
                ready = true
                queued.forEach { view.evaluateJavascript(it, null) }
                queued.clear()
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i("Vektra", "engine: ${message.message()}")
                return true
            }
        }
        // Attached, so it keeps running like a page on screen; 1 px and see-through.
        parent.addView(this, FrameLayout.LayoutParams(1, 1))
        loadUrl("https://appassets.androidplatform.net/assets/web/engine.html")
    }

    private inner class Engine {
        @JavascriptInterface
        fun reply(id: Int, json: String) {
            handler.post { waiting.remove(id)?.invoke(JSONObject(json)) }
        }

        @JavascriptInterface
        fun progress(done: Int, total: Int) {
            handler.post { onProgress?.invoke(done, total) }
        }
    }

    /** The name NativeLayer paints through, as in the hint overlay. */
    private inner class Painter {
        @JavascriptInterface
        fun render(frame: String) {
            handler.post { onFrame?.invoke(frame) }
        }
    }

    private fun js(script: String) {
        if (ready) webView.evaluateJavascript(script, null) else queued += script
    }

    /** Calls `vektra.<method>(id, args)` in the page; `args` is JSON. */
    fun call(method: String, args: String, answer: (JSONObject) -> Unit) {
        val id = nextId++
        waiting[id] = answer
        js("vektra.$method($id, $args)")
    }

    /** The review board's marks at a ply (they arrive through onFrame). */
    fun frame(ply: Int, line: Boolean, flipped: Boolean) = js("vektra.frame({ply:$ply,line:$line,flipped:$flipped})")

    /** Stops an analysis; its call is never answered. */
    fun cancel() = js("vektra.cancel()")

    fun destroy() = webView.destroy()
}
