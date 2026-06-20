// ABOUTME: Renders JetBrains Pi x IDE connection and selection state in the IDE status bar.
// ABOUTME: Lets users attach the active file or selection by clicking the widget.
package com.balaenis.pixide.ui

import com.balaenis.pixide.PiXIdeProjectService
import com.balaenis.pixide.actions.PiXIdeAttachSelectionAction
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.impl.status.EditorBasedWidget
import java.awt.Component
import java.awt.event.MouseEvent
import com.intellij.util.Consumer

class PiXIdeStatusBarWidget(
    private val widgetProject: Project,
) : EditorBasedWidget(widgetProject), StatusBarWidget.TextPresentation {
    override fun ID(): String = PiXIdeStatusBarWidgetFactory.WIDGET_ID

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun getText(): String = widgetProject.service<PiXIdeProjectService>().statusText()

    override fun getTooltipText(): String = widgetProject.service<PiXIdeProjectService>().tooltipText()

    override fun getAlignment(): Float = Component.CENTER_ALIGNMENT

    override fun getClickConsumer(): Consumer<MouseEvent> = Consumer {
        PiXIdeAttachSelectionAction.attach(widgetProject)
    }
}
