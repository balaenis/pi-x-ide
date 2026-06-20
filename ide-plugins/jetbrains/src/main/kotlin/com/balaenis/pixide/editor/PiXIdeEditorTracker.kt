// ABOUTME: Subscribes to JetBrains editor, caret, selection, and project-root events.
// ABOUTME: Debounces event bursts and asks the project service to publish current selection state.
package com.balaenis.pixide.editor

import com.balaenis.pixide.PiXIdeProjectService
import com.balaenis.pixide.util.PiXIdeDebouncer
import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ModuleRootEvent
import com.intellij.openapi.roots.ModuleRootListener

class PiXIdeEditorTracker(
    private val project: Project,
    private val service: PiXIdeProjectService,
) {
    private val debouncer = PiXIdeDebouncer()
    private var started = false

    fun start(parentDisposable: Disposable) {
        if (started) return
        started = true
        val connection = project.messageBus.connect(parentDisposable)
        connection.subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : FileEditorManagerListener {
                override fun selectionChanged(event: FileEditorManagerEvent) = publishSoon()
            },
        )
        connection.subscribe(
            ModuleRootListener.TOPIC,
            object : ModuleRootListener {
                override fun rootsChanged(event: ModuleRootEvent) {
                    service.refreshWorkspaceFolders()
                    publishSoon()
                }
            },
        )

        val multicaster = EditorFactory.getInstance().eventMulticaster
        multicaster.addSelectionListener(
            object : SelectionListener {
                override fun selectionChanged(e: SelectionEvent) = publishSoon()
            },
            parentDisposable,
        )
        multicaster.addCaretListener(
            object : CaretListener {
                override fun caretPositionChanged(event: CaretEvent) = publishSoon()
                override fun caretAdded(event: CaretEvent) = publishSoon()
                override fun caretRemoved(event: CaretEvent) = publishSoon()
            },
            parentDisposable,
        )

        service.refreshWorkspaceFolders()
        publishSoon()
    }

    fun stop() {
        debouncer.dispose()
        started = false
    }

    private fun publishSoon() {
        debouncer.schedule { service.publishCurrentSelection() }
    }
}
