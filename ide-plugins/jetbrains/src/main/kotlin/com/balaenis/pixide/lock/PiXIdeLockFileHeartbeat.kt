// ABOUTME: Owns the repeating Swing lock-file heartbeat for JetBrains project sessions.
// ABOUTME: Restores an owned lock on a 15-minute timer and stops synchronously on the EDT.
package com.balaenis.pixide.lock

import javax.swing.SwingUtilities
import javax.swing.Timer

class PiXIdeLockFileHeartbeat(
    private val intervalMs: Int = LOCK_FILE_HEARTBEAT_INTERVAL_MS,
    private val refresh: () -> Unit,
) {
    private var disposed = false
    private var timer: Timer? = null

    fun start() {
        runOnEdt {
            if (disposed || timer != null) return@runOnEdt
            timer = Timer(intervalMs) {
                runCatching { refresh() }
            }.apply {
                isRepeats = true
                initialDelay = intervalMs
                start()
            }
        }
    }

    fun dispose() {
        runOnEdt {
            if (disposed) return@runOnEdt
            disposed = true
            timer?.stop()
            timer = null
        }
    }

    private fun runOnEdt(action: () -> Unit) {
        if (SwingUtilities.isEventDispatchThread()) {
            action()
        } else {
            SwingUtilities.invokeAndWait(action)
        }
    }

    companion object {
        const val LOCK_FILE_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000
    }
}
