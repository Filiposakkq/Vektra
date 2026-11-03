package com.vektra.app

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Reads the board in Chess.com bot games and shows hints over it (HintOverlay).
 * It turns off whenever Chess.com isn't in front or its screen isn't a bot
 * game, and it never taps, types or performs gestures.
 */
class VektraAccessibilityService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    /** The Chess.com screen (activity) last seen in front. */
    private var chessScreen: String? = null
    private val isActivityCache = HashMap<String, Boolean>()
    private val check = Runnable { checkScreen() }
    private val settledCheck = Runnable { checkScreen() }
    private var overlay: HintOverlay? = null
    /** When the screen first changed since the last read, and how long the last read came after it. */
    private var changedAt = 0L
    private var readDelayMs = 0L
    private var lastReadAt = 0L
    /** How long collecting the last screen took. */
    private var readCostMs = 0L
    private var readScheduled = false
    /** Move announcements came through in this game: moves arrive that way, and reads wait for quiet. */
    private var announcementsSeen = false
    /** The coach was seen on this game screen: Vektra stays off until another screen opens. */
    private var coachGame = false
    private val settingsListener: (HintSettings) -> Unit = { settings -> handler.post { overlay?.applySettings(settings) } }

    override fun onServiceConnected() {
        PositionStore.serviceRunning = true
        overlay = HintOverlay(this)
        SettingsStore.addListener(settingsListener)
        report(PositionStore.State.Off("Waiting for a Chess.com bot game."))
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val pkg = event.packageName?.toString() ?: return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && pkg == BotGameGuard.CHESS_PACKAGE) {
            // Dialogs and popups send this event too; only a new activity is a new screen.
            val cls = event.className?.toString()
            if (cls != null && isChessActivity(cls)) {
                chessScreen = cls
                coachGame = false
            }
        }
        // Chess.com announces each move for screen readers ("Bílý Dáma z d1 na
        // d4") the moment it is played, well before the board can be read:
        // apply it at once. The board reads that follow check it.
        if (pkg == BotGameGuard.CHESS_PACKAGE &&
            event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            event.contentChangeTypes and AccessibilityEvent.CONTENT_CHANGE_TYPE_TEXT != 0 &&
            event.className == "android.widget.TextView" &&
            PositionStore.state is PositionStore.State.On
        ) {
            val text = event.text.joinToString(" ").ifBlank { event.source?.text?.toString().orEmpty() }
            val move = MoveAnnouncement.parse(text)
            if (move != null) {
                Log.i(TAG, "announced: ${move.color ?: '?'} ${move.piece} ${move.squares.joinToString(" ")}")
                announcementsSeen = true
                overlay?.played(move)
            } else if (Regex("""\b[a-h][1-8]\b""").containsMatchIn(text) ||
                text.lowercase().split(' ', ',', '.', ':').any { it in PieceNames.PIECES || it in PieceNames.COLORS }
            ) {
                // A square, piece or colour that isn't understood: perhaps a new wording.
                Log.i(TAG, "not understood as a move: ${text.take(80)}")
            }
        }
        val now = SystemClock.uptimeMillis()
        if (changedAt == 0L) changedAt = now
        // Each read makes Chess.com's app describe its screen on the thread
        // that animates its pieces and sends its move announcements, so a read
        // during a move holds the announcement back. Once announcements come
        // through, moves arrive that way and the board is only read when the
        // screen has gone quiet (or, if it never does, MAX_WAIT_MS after the
        // change), to check them.
        if (announcementsSeen) {
            if (!readScheduled) {
                readScheduled = true
                handler.postDelayed(check, MAX_WAIT_MS)
            }
            handler.removeCallbacks(settledCheck)
            handler.postDelayed(settledCheck, QUIET_MS)
            return
        }
        // Until then (entering a game), read soon after a change, but not too
        // often. A board caught mid-animation is caught by the overlay page
        // (it ignores impossible positions).
        if (!readScheduled) {
            readScheduled = true
            handler.postDelayed(check, maxOf(FIRST_READ_MS, lastReadAt + READ_GAP_MS - now))
        }
        // And once more when the screen has settled, in case the early read
        // caught a half-finished move and nothing changes after it.
        handler.removeCallbacks(settledCheck)
        handler.postDelayed(settledCheck, SETTLED_MS)
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        handler.removeCallbacks(check)
        handler.removeCallbacks(settledCheck)
        report(PositionStore.State.Off("Vektra's accessibility service isn't running."))
        PositionStore.serviceRunning = false
        SettingsStore.removeListener(settingsListener)
        overlay?.destroy()
        overlay = null
        super.onDestroy()
    }

    private fun checkScreen() {
        handler.removeCallbacks(check)
        handler.removeCallbacks(settledCheck)
        readScheduled = false
        lastReadAt = SystemClock.uptimeMillis()
        readDelayMs = lastReadAt - changedAt
        changedAt = 0L
        // Not read again until another screen opens: the coach's screen changes
        // all the time, and each read slows Chess.com's app down.
        if (coachGame) {
            report(PositionStore.State.Off(COACH_GAME))
            return
        }
        val root = activeRoot()
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
        val started = SystemClock.uptimeMillis()
        collect(root, labels, texts)
        readCostMs = SystemClock.uptimeMillis() - started
        if (BotGameGuard.isCoachGame(labels)) {
            coachGame = true
            report(PositionStore.State.Off(COACH_GAME))
            return
        }
        when (val result = BoardParser.parse(labels)) {
            is BoardResult.Unreadable -> report(PositionStore.State.Off("Bot game, but the board can't be read: ${result.reason}"))
            is BoardResult.Read -> report(PositionStore.State.On(GameReading(result.board, MoveListParser.parse(texts))))
        }
    }

    /**
     * The window in front. Every node read is a request to Chess.com's app,
     * answered on the thread that animates its pieces; on Android 13+ the
     * whole screen comes in a few batches instead of one request per node.
     */
    private fun activeRoot(): AccessibilityNodeInfo? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getRootInActiveWindow(AccessibilityNodeInfo.FLAG_PREFETCH_DESCENDANTS_HYBRID)
        } else {
            rootInActiveWindow
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
            is PositionStore.State.On -> overlay?.show(state.reading)
            is PositionStore.State.Off -> {
                overlay?.hide()
                // A new game starts with early reads until its first announcement.
                announcementsSeen = false
            }
        }
        when (state) {
            is PositionStore.State.Off -> Log.i(TAG, "off: ${state.reason}")
            is PositionStore.State.On -> Log.i(
                TAG,
                "bot game: ${state.reading.fenStart} flipped=${state.reading.board.flipped} " +
                    "moves=${state.reading.moves.tokens.joinToString(" ")} (read ${readDelayMs} ms after the screen changed, in ${readCostMs} ms)",
            )
        }
    }

    private companion object {
        const val TAG = "Vektra"
        const val COACH_GAME = "Coach game: Chess.com shows its own arrows, move feedback and eval bar, so Vektra stays off."
        /** From the first change to the first read. */
        const val FIRST_READ_MS = 60L
        /** Reads come at most this often while the screen keeps changing. */
        const val READ_GAP_MS = 150L
        /** Quiet time after which the screen is read once more. */
        const val SETTLED_MS = 300L
        /** Once announcements come through: how long the screen must be quiet before a check. */
        const val QUIET_MS = 250L
        /** ...and the longest wait for a check while the screen keeps changing. */
        const val MAX_WAIT_MS = 1000L
    }
}
