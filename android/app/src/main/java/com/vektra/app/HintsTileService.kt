package com.vektra.app

import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** A quick settings tile that turns the hints in bot games on and off ("Hints in bot games"). */
class HintsTileService : TileService() {
    override fun onStartListening() = show(SettingsStore.load(this).enabled)

    override fun onClick() {
        val next = SettingsStore.load(this).let { it.copy(enabled = !it.enabled) }
        SettingsStore.save(this, next)
        show(next.enabled)
    }

    private fun show(enabled: Boolean) {
        val tile = qsTile ?: return
        tile.state = if (enabled) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.updateTile()
    }
}
