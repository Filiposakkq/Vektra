package com.vektra.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * The last bot game Vektra followed from its first move, as the overlay page
 * recorded it ({"sans": [...], "flipped": ...}): Chess.com's public archive
 * has no bot games, so this is the only way to review one.
 */
object LastGame {
    private const val PREFS = "lastGame"

    fun save(context: Context, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("game", json)
            .putLong("at", System.currentTimeMillis())
            .apply()
    }

    fun load(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("game", null)

    /** When it was last played (milliseconds), or 0. */
    fun playedAt(context: Context): Long = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("at", 0)
}

/** Reviews finished games from Chess.com's public archive, or the last bot game: the page android/web/review.ts. */
class ReviewActivity : Activity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Served over https like the overlay, so the engine's worker and wasm load.
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            // The last username typed is kept in the page's localStorage.
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)
            }
            addJavascriptInterface(Bridge(), "VektraReview")
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.i(TAG, "review: ${message.message()}")
                    return true
                }
            }
        }
        setContentView(webView)
        // #last opens the last bot game Vektra recorded instead of the game list.
        val page = if (intent.getBooleanExtra(EXTRA_LAST_GAME, false)) "review.html#last" else "review.html"
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/$page")
    }

    /** What the page asks of the app: the settings (analysis depth), the last bot game, and closing from the bar's back arrow. */
    private inner class Bridge {
        @JavascriptInterface
        fun settings(): String = SettingsStore.load(this@ReviewActivity).toJson()

        @JavascriptInterface
        fun lastGame(): String = LastGame.load(this@ReviewActivity) ?: ""

        @JavascriptInterface
        fun close() = runOnUiThread { finish() }
    }

    @Deprecated("Still called on the Android versions Vektra supports")
    override fun onBackPressed() {
        // From a game back to the list.
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "Vektra"
        const val EXTRA_LAST_GAME = "lastGame"
    }
}
