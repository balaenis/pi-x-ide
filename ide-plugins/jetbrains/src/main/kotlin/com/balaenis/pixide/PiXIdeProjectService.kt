// ABOUTME: Orchestrates JetBrains project lifecycle for pi-x-ide selection integration.
// ABOUTME: Owns the WebSocket server, lock file, editor tracking, attach handling, and status refresh.
package com.balaenis.pixide

import com.balaenis.pixide.editor.PiXIdeEditorTracker
import com.balaenis.pixide.editor.PiXIdeSnapshotBuilder
import com.balaenis.pixide.editor.PiXIdeWorkspace
import com.balaenis.pixide.lock.PiXIdeLockFileManager
import com.balaenis.pixide.protocol.EditorSelectionSnapshot
import com.balaenis.pixide.protocol.SelectionClearedParams
import com.balaenis.pixide.server.PiXIdeWebSocketServer
import com.balaenis.pixide.ui.PiXIdeStatusBarWidgetFactory
import com.intellij.ide.plugins.PluginManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.WindowManager
import java.util.concurrent.atomic.AtomicBoolean

class PiXIdeProjectService(
    private val project: Project,
) : Disposable {
    private val lockFileManager = PiXIdeLockFileManager()
    private val started = AtomicBoolean(false)
    private var server: PiXIdeWebSocketServer? = null
    private var editorTracker: PiXIdeEditorTracker? = null

    @Volatile
    private var latestSnapshot: EditorSelectionSnapshot? = null

    @Volatile
    private var status: ServiceStatus = ServiceStatus.Idle

    fun start() {
        if (!started.compareAndSet(false, true)) return
        try {
            val token = PiXIdeLockFileManager.createAuthToken()
            val webSocketServer = PiXIdeWebSocketServer(
                authToken = token,
                pluginVersion = pluginVersion(),
                getInitialSelection = { currentSnapshot() },
                onClientCountChanged = { updateStatusBar() },
            )
            val port = webSocketServer.start()
            server = webSocketServer
            lockFileManager.write(port, token, PiXIdeWorkspace.workspaceFolders(project))
            status = ServiceStatus.Running

            editorTracker = PiXIdeEditorTracker(project, this).also { it.start(this) }
            publishCurrentSelection()
            updateStatusBar()
        } catch (error: Throwable) {
            LOG.warn("Failed to start Pi x IDE JetBrains integration", error)
            status = ServiceStatus.Failed(error.message ?: error.javaClass.simpleName)
            started.set(false)
            runCatching { lockFileManager.cleanup() }
            runCatching { server?.stop() }
            server = null
            updateStatusBar()
        }
    }

    fun publishCurrentSelection() {
        val snapshot = currentSnapshot()
        if (snapshot != null) {
            latestSnapshot = snapshot
            server?.broadcastNotification("selection_changed", snapshot.copy(receivedAt = System.currentTimeMillis()))
        } else {
            latestSnapshot = null
            server?.broadcastNotification("selection_cleared", SelectionClearedParams(receivedAt = System.currentTimeMillis()))
        }
        updateStatusBar()
    }

    fun refreshWorkspaceFolders() {
        runCatching { lockFileManager.refresh(PiXIdeWorkspace.workspaceFolders(project)) }
            .onFailure { LOG.warn("Failed to refresh Pi x IDE lock file", it) }
    }

    fun attachCurrentSelection(): AttachResult {
        val snapshot = currentSnapshot() ?: return AttachResult.NoActiveFile
        latestSnapshot = snapshot
        val rangeText = formatRangeMention(snapshot)
        val sent = server?.sendAtMentioned(snapshot, rangeText) == true
        updateStatusBar()
        return if (sent) AttachResult.Attached(rangeText) else AttachResult.NoClients(rangeText)
    }

    fun clientCount(): Int = server?.clientCount ?: 0

    fun statusText(): String {
        latestSnapshot?.let { return "⧉ Pi x IDE ${formatRangeMention(it)}" }
        val clients = clientCount()
        if (clients > 0) return "⧉ Pi x IDE $clients Pi"
        return when (val current = status) {
            ServiceStatus.Idle -> "⧉ Pi x IDE idle"
            ServiceStatus.Running -> "⧉ Pi x IDE waiting"
            is ServiceStatus.Failed -> "⧉ Pi x IDE failed"
        }
    }

    fun tooltipText(): String = when (val current = status) {
        ServiceStatus.Idle -> "Pi x IDE is idle"
        ServiceStatus.Running -> "Pi x IDE JetBrains server is listening on port ${server?.port ?: 0}"
        is ServiceStatus.Failed -> "Pi x IDE failed to start: ${current.message}"
    }

    fun latestSnapshot(): EditorSelectionSnapshot? = latestSnapshot

    fun formatRangeMention(snapshot: EditorSelectionSnapshot): String {
        val relative = PiXIdeWorkspace.relativePath(snapshot.filePath, snapshot.workspaceFolder)
        val first = snapshot.ranges.firstOrNull() ?: return "@$relative"
        val startLine = first.selection.start.line + 1
        val endLine = first.selection.end.line + 1
        val lineSpan = if (startLine == endLine) "L$startLine" else "L$startLine-L$endLine"
        return "@$relative#$lineSpan"
    }

    override fun dispose() {
        editorTracker?.stop()
        editorTracker = null
        runCatching { lockFileManager.cleanup() }
        runCatching { server?.stop() }
        server = null
        latestSnapshot = null
        status = ServiceStatus.Idle
        started.set(false)
        updateStatusBar()
    }

    private fun currentSnapshot(): EditorSelectionSnapshot? =
        runCatching { PiXIdeSnapshotBuilder.activeSnapshot(project) }
            .onFailure { LOG.warn("Failed to build Pi x IDE selection snapshot", it) }
            .getOrNull()

    private fun updateStatusBar() {
        val application = ApplicationManager.getApplication()
        application.invokeLater(
            {
                if (!project.isDisposed) {
                    WindowManager.getInstance().getStatusBar(project)?.updateWidget(PiXIdeStatusBarWidgetFactory.WIDGET_ID)
                }
            },
            ModalityState.any(),
        )
    }

    private fun pluginVersion(): String =
        PluginManager.getInstance().findEnabledPlugin(PluginId.getId("balaenis.pi-x-ide"))?.version ?: "dev"

    sealed class AttachResult {
        data class Attached(val rangeText: String) : AttachResult()
        data class NoClients(val rangeText: String) : AttachResult()
        object NoActiveFile : AttachResult()
    }

    private sealed class ServiceStatus {
        object Idle : ServiceStatus()
        object Running : ServiceStatus()
        data class Failed(val message: String) : ServiceStatus()
    }

    companion object {
        private val LOG = Logger.getInstance(PiXIdeProjectService::class.java)

        fun getInstance(project: Project): PiXIdeProjectService = project.service()
    }
}
