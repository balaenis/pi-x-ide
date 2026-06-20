// ABOUTME: Implements the JetBrains action that attaches the active file or selection to Pi.
// ABOUTME: Sends at_mentioned notifications when Pi is connected and surfaces user-facing status balloons.
package com.balaenis.pixide.actions

import com.balaenis.pixide.PiXIdeProjectService
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project

class PiXIdeAttachSelectionAction : DumbAwareAction() {
    override fun update(event: AnActionEvent) {
        event.presentation.isEnabled = event.project != null
    }

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        attach(project)
    }

    companion object {
        private const val NOTIFICATION_GROUP = "Pi x IDE Notifications"

        fun attach(project: Project) {
            when (val result = PiXIdeProjectService.getInstance(project).attachCurrentSelection()) {
                is PiXIdeProjectService.AttachResult.Attached -> {
                    notify(project, "Pi x IDE attached ${result.rangeText}", NotificationType.INFORMATION)
                }
                is PiXIdeProjectService.AttachResult.NoClients -> {
                    notify(project, "Pi x IDE: no Pi clients connected. Reference: ${result.rangeText}", NotificationType.WARNING)
                }
                PiXIdeProjectService.AttachResult.NoActiveFile -> {
                    notify(project, "Pi x IDE: no active file to attach.", NotificationType.WARNING)
                }
            }
        }

        fun notify(project: Project, content: String, type: NotificationType) {
            NotificationGroupManager.getInstance()
                .getNotificationGroup(NOTIFICATION_GROUP)
                .createNotification(content, type)
                .notify(project)
        }
    }
}
