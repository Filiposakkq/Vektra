package com.vektra.app

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Reads the board in Chess.com bot games (milestone 1: it only logs and shows
 * what it read). It turns off whenever Chess.com isn't in front or its screen
 * isn't a bot game, and it never taps, types or performs gestures.
 */
class VektraAccessibilityService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    /** The Chess.com screen (activity) last seen in front. */
    private var chessScreen: String? = null
    private val isActivityCache = HashMap<String, Boolean>()
    private val check = Runnable { checkScreen() }

    override fun onServiceConnected() {
        report(PositionStore.State.Off("Waiting for a Chess.com bot game."))
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val pkg = event.packageName?.toString() ?: return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && pkg == BotGameGuard.CHESS_PACKAGE) {
            // Dialogs and popups send this event too; only a new activity is a new screen.
            val cls = event.className?.toString()
            if (cls != null && isChessActivity(cls)) chessScreen = cls
        }
        // Boards change often; read once things settle.
        handler.removeCallbacks(check)
        handler.postDelayed(check, SETTLE_MS)
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        handler.removeCallbacks(check)
        report(PositionStore.State.Off("Vektra's accessibility service isn't running."))
        super.onDestroy()
    }

    private fun checkScreen() {
        val root = rootInActiveWindow
        if (root?.packageName?.toString() != BotGameGuard.CHESS_PACKAGE) {
            report(PositionStore.State.Off("Chess.com isn't in front."))
            return
        }
        if (!BotGameGuard.isBotGame(BotGameGuard.CHESS_PACKAGE, chessScreen)) {
            report(PositionStore.State.Off("Not a bot game (Chess.com screen: ${chessScreen?.substringAfterLast('.') ?: "unknown"})."))
            return
        }
        val labels = ArrayList<ScreenLabel>()
        val texts = ArrayList<String>()
        collect(root, labels, texts)
        when (val result = BoardParser.parse(labels)) {
            is BoardResult.Unreadable -> report(PositionStore.State.Off("Bot game, but the board can't be read: ${result.reason}"))
            is BoardResult.Read -> report(PositionStore.State.On(GameReading(result.board, MoveListParser.parse(texts))))
        }
    }

    private fun collect(node: AccessibilityNodeInfo?, labels: MutableList<ScreenLabel>, texts: MutableList<String>) {
        node ?: return
        node.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let {
            val r = Rect()
            node.getBoundsInScreen(r)
            labels += ScreenLabel(it, r.left, r.top, r.right, r.bottom)
        }
        node.text?.toString()?.takeIf { it.isNotBlank() }?.let { texts += it }
        for (i in 0 until node.childCount) collect(node.getChild(i), labels, texts)
    }

    private fun isChessActivity(cls: String): Boolean = isActivityCache.getOrPut(cls) {
        try {
            packageManager.getActivityInfo(ComponentName(BotGameGuard.CHESS_PACKAGE, cls), 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    private fun report(state: PositionStore.State) {
        if (!PositionStore.update(state)) return
        when (state) {
            is PositionStore.State.Off -> Log.i(TAG, "off: ${state.reason}")
            is PositionStore.State.On -> Log.i(
                TAG,
                "bot game: ${state.reading.fenStart} flipped=${state.reading.board.flipped} moves=${state.reading.moves.tokens.joinToString(" ")}",
            )
        }
    }

    private companion object {
        const val TAG = "Vektra"
        const val SETTLE_MS = 300L
    }
}
