// ABOUTME: Opens a JetBrains embedded terminal in the project directory and runs Pi.
// ABOUTME: Provides the IDE-side entry point for starting a Pi session from JetBrains.
package com.balaenis.pixide.actions

import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager

class PiXIdeOpenTerminalAction : DumbAwareAction() {
    override fun update(event: AnActionEvent) {
        event.presentation.isEnabled = event.project != null
    }

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        ApplicationManager.getApplication().invokeLater {
            try {
                val workingDirectory = project.basePath ?: System.getProperty("user.home")
                TerminalToolWindowTabsManager.getInstance(project)
                    .createTabBuilder()
                    .workingDirectory(workingDirectory)
                    .tabName("Pi")
                    .requestFocus(true)
                    .shellCommand(listOf("pi"))
                    .createTab()
                ToolWindowManager.getInstance(project).getToolWindow("Terminal")?.activate(null)
            } catch (error: Throwable) {
                PiXIdeAttachSelectionAction.notify(
                    project,
                    "Pi x IDE: failed to open Pi terminal: ${error.message ?: error.javaClass.simpleName}",
                    NotificationType.ERROR,
                )
            }
        }
    }
}
