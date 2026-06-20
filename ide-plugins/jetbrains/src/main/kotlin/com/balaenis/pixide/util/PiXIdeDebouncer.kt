// ABOUTME: Provides a disposable Swing timer debouncer for JetBrains editor events.
// ABOUTME: Coalesces rapid caret and selection changes before publishing state to Pi.
package com.balaenis.pixide.util

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import javax.swing.Timer

class PiXIdeDebouncer(
    private val delayMillis: Int = 150,
) : Disposable {
    private var pendingAction: (() -> Unit)? = null
    private val timer = Timer(delayMillis) {
        val action = pendingAction
        pendingAction = null
        action?.invoke()
    }.apply {
        isRepeats = false
    }

    fun schedule(action: () -> Unit) {
        pendingAction = action
        val restart = {
            timer.initialDelay = delayMillis
            timer.restart()
        }
        val application = ApplicationManager.getApplication()
        if (application.isDispatchThread) restart() else application.invokeLater(restart)
    }

    override fun dispose() {
        pendingAction = null
        timer.stop()
    }
}
