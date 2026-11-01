package com.vektra.app

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Shows whether Vektra's accessibility service is on and what it last read. */
class MainActivity : Activity() {
    private lateinit var serviceText: TextView
    private lateinit var statusText: TextView
    private lateinit var boardText: TextView
    private val listener: (PositionStore.State) -> Unit = { runOnUiThread { render() } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        layout.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 26f
        })
        layout.addView(TextView(this).apply {
            text = "Version ${packageManager.getPackageInfo(packageName, 0).versionName}. " +
                "In Chess.com bot games Vektra shows the engine's best moves over the board on your turn."
        })
        serviceText = TextView(this).apply { setPadding(0, pad, 0, 0) }
        layout.addView(serviceText)
        layout.addView(Button(this).apply {
            text = "Open accessibility settings"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        })
        statusText = TextView(this).apply { setPadding(0, pad, 0, 0) }
        layout.addView(statusText)
        boardText = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 18f
            setPadding(0, pad / 2, 0, 0)
        }
        layout.addView(boardText)
        setContentView(ScrollView(this).apply { addView(layout) })
    }

    override fun onResume() {
        super.onResume()
        PositionStore.addListener(listener)
        render()
    }

    override fun onPause() {
        PositionStore.removeListener(listener)
        super.onPause()
    }

    private fun render() {
        serviceText.text = if (serviceEnabled()) {
            "Accessibility service: on."
        } else {
            "Accessibility service: off. Turn on Vektra in the accessibility settings (on Xiaomi: " +
                "Additional settings → Accessibility → Downloaded apps). If it is greyed out, open " +
                "Vektra's app info, tap ⋮ and choose Allow restricted settings, then try again."
        }
        val state = PositionStore.state
        statusText.text = when (state) {
            is PositionStore.State.On -> "In a bot game."
            is PositionStore.State.Off -> state.reason
        }
        val reading = (state as? PositionStore.State.On)?.reading ?: PositionStore.lastReading
        boardText.text = reading?.let { describe(it, current = state is PositionStore.State.On) } ?: ""
    }

    private fun describe(reading: GameReading, current: Boolean): String {
        val side = when (reading.moves.sideToMove) {
            'w' -> "White to move"
            'b' -> "Black to move"
            else -> "side to move unknown"
        }
        val rows = reading.board.placement.split('/').map { row ->
            row.flatMap { c -> if (c.isDigit()) List(c.digitToInt()) { '.' } else listOf(c) }
        }
        // As on screen: from Black's side when the board is flipped.
        val shown = if (reading.board.flipped) rows.reversed().map { it.reversed() } else rows
        return buildString {
            appendLine(if (current) "Board now:" else "Last board read:")
            shown.forEach { appendLine(it.joinToString(" ")) }
            appendLine()
            appendLine("$side, ${if (reading.board.flipped) "you play Black" else "you play White"}")
            appendLine("Moves on screen: ${reading.moves.tokens.joinToString(" ").ifEmpty { "none" }}")
            append("FEN start: ${reading.fenStart}")
        }
    }

    private fun serviceEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val mine = ComponentName(this, VektraAccessibilityService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == mine }
    }
}
