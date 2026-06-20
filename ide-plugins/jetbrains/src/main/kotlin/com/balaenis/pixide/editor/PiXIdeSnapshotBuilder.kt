// ABOUTME: Converts JetBrains active editor state into pi-x-ide selection snapshots.
// ABOUTME: Preserves protocol line and character semantics using UTF-16 document offsets.
package com.balaenis.pixide.editor

import com.balaenis.pixide.protocol.EditorSelectionSnapshot
import com.balaenis.pixide.protocol.IDE_SOURCE
import com.balaenis.pixide.protocol.Position
import com.balaenis.pixide.protocol.ProtocolRange
import com.balaenis.pixide.protocol.SelectionRange
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Ref
import com.intellij.openapi.util.TextRange

object PiXIdeSnapshotBuilder {
    data class OffsetSelection(
        val startOffset: Int,
        val endOffset: Int,
    )

    fun activeSnapshot(project: Project): EditorSelectionSnapshot? {
        val application = ApplicationManager.getApplication()
        if (application.isDispatchThread) return activeSnapshotOnEdt(project)
        val ref = Ref<EditorSelectionSnapshot?>()
        application.invokeAndWait { ref.set(activeSnapshotOnEdt(project)) }
        return ref.get()
    }

    fun buildSnapshot(
        filePath: String,
        workspaceFolder: String?,
        document: Document,
        selections: List<OffsetSelection>,
    ): EditorSelectionSnapshot {
        val ranges = selections
            .mapNotNull { selectionRange(document, it) }
            .sortedWith(compareBy({ it.selection.start.line }, { it.selection.start.character }))
        return EditorSelectionSnapshot(
            source = IDE_SOURCE,
            filePath = filePath,
            workspaceFolder = workspaceFolder,
            ranges = ranges,
        )
    }

    fun offsetToPosition(document: Document, offset: Int): Position {
        val clamped = offset.coerceIn(0, document.textLength)
        val line = document.getLineNumber(clamped)
        val character = clamped - document.getLineStartOffset(line)
        return Position(line = line, character = character)
    }

    private fun activeSnapshotOnEdt(project: Project): EditorSelectionSnapshot? {
        val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return null
        val document = editor.document
        val virtualFile = FileDocumentManager.getInstance().getFile(document) ?: return null
        if (!virtualFile.isInLocalFileSystem) return null

        val filePath = virtualFile.path
        val workspaceFolder = PiXIdeWorkspace.bestWorkspaceFolder(project, filePath)
        val selections = editor.caretModel.allCarets
            .mapNotNull { caret ->
                if (!caret.hasSelection()) return@mapNotNull null
                OffsetSelection(caret.selectionStart, caret.selectionEnd)
            }
        return buildSnapshot(filePath, workspaceFolder, document, selections)
    }

    private fun selectionRange(document: Document, selection: OffsetSelection): SelectionRange? {
        val startOffset = selection.startOffset.coerceIn(0, document.textLength)
        val endOffset = selection.endOffset.coerceIn(0, document.textLength)
        if (startOffset == endOffset) return null
        val start = minOf(startOffset, endOffset)
        val end = maxOf(startOffset, endOffset)
        val text = selectedText(document, start, end)
        return SelectionRange(
            text = text,
            selection = ProtocolRange(
                start = offsetToPosition(document, start),
                end = offsetToPosition(document, end),
            ),
        )
    }

    private fun selectedText(document: Document, start: Int, end: Int): String {
        val range = TextRange(start, end)
        val application = ApplicationManager.getApplication()
        return if (application != null) {
            application.runReadAction<String> { document.getText(range) }
        } else {
            document.charsSequence.subSequence(start, end).toString()
        }
    }
}
