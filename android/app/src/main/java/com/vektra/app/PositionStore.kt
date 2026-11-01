package com.vektra.app

import java.util.concurrent.CopyOnWriteArrayList

/** What Vektra read in a bot game. */
data class GameReading(val board: BoardReading, val moves: VisibleMoves) {
    /** The position as far as the board and visible moves tell it: placement and side to move. */
    val fenStart get() = "${board.placement} ${moves.sideToMove ?: '?'}"
}

/** Where Vektra stands, shared between the accessibility service and the app screen. */
object PositionStore {
    sealed interface State {
        data class Off(val reason: String) : State
        data class On(val reading: GameReading) : State
    }

    @Volatile
    var state: State = State.Off("Vektra's accessibility service isn't running.")
        private set

    /** The last board read in a bot game, kept after Vektra turns off. */
    @Volatile
    var lastReading: GameReading? = null
        private set

    private val listeners = CopyOnWriteArrayList<(State) -> Unit>()

    fun addListener(listener: (State) -> Unit) = listeners.add(listener)
    fun removeListener(listener: (State) -> Unit) = listeners.remove(listener)

    /** Returns true when the state changed. */
    fun update(next: State): Boolean {
        if (next == state) return false
        state = next
        if (next is State.On) lastReading = next.reading
        listeners.forEach { it(next) }
        return true
    }
}
