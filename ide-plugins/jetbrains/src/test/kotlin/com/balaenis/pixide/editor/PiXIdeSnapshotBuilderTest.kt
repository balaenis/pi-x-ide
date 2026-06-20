// ABOUTME: Tests conversion from JetBrains document offsets to pi-x-ide selection snapshots.
// ABOUTME: Covers UTF-16 character offsets, empty selections, multi-line ranges, and multi-caret sorting.
package com.balaenis.pixide.editor

import com.intellij.openapi.editor.impl.DocumentImpl
import kotlin.test.Test
import kotlin.test.assertEquals

class PiXIdeSnapshotBuilderTest {
    @Test
    fun convertsSingleLineAsciiSelection() {
        val document = DocumentImpl("alpha beta")
        val snapshot = PiXIdeSnapshotBuilder.buildSnapshot(
            filePath = "/repo/src/main.kt",
            workspaceFolder = "/repo",
            document = document,
            selections = listOf(PiXIdeSnapshotBuilder.OffsetSelection(6, 10)),
        )

        val range = snapshot.ranges.single()
        assertEquals("beta", range.text)
        assertEquals(0, range.selection.start.line)
        assertEquals(6, range.selection.start.character)
        assertEquals(0, range.selection.end.line)
        assertEquals(10, range.selection.end.character)
    }

    @Test
    fun convertsMultiLineSelection() {
        val document = DocumentImpl("one\ntwo\nthree")
        val snapshot = PiXIdeSnapshotBuilder.buildSnapshot(
            filePath = "/repo/src/main.kt",
            workspaceFolder = "/repo",
            document = document,
            selections = listOf(PiXIdeSnapshotBuilder.OffsetSelection(2, 8)),
        )

        val range = snapshot.ranges.single()
        assertEquals("e\ntwo\n", range.text)
        assertEquals(0, range.selection.start.line)
        assertEquals(2, range.selection.start.character)
        assertEquals(2, range.selection.end.line)
        assertEquals(0, range.selection.end.character)
    }

    @Test
    fun countsAstralEmojiAsTwoUtf16CodeUnits() {
        val document = DocumentImpl("a😀b")
        val snapshot = PiXIdeSnapshotBuilder.buildSnapshot(
            filePath = "/repo/src/main.kt",
            workspaceFolder = "/repo",
            document = document,
            selections = listOf(PiXIdeSnapshotBuilder.OffsetSelection(3, 4)),
        )

        val range = snapshot.ranges.single()
        assertEquals("b", range.text)
        assertEquals(3, range.selection.start.character)
        assertEquals(4, range.selection.end.character)
    }

    @Test
    fun activeFileWithoutSelectedTextYieldsEmptyRanges() {
        val document = DocumentImpl("content")
        val snapshot = PiXIdeSnapshotBuilder.buildSnapshot(
            filePath = "/repo/src/main.kt",
            workspaceFolder = "/repo",
            document = document,
            selections = emptyList(),
        )

        assertEquals("jetbrains", snapshot.source)
        assertEquals("/repo/src/main.kt", snapshot.filePath)
        assertEquals(0, snapshot.ranges.size)
    }

    @Test
    fun multipleSelectionsAreSortedByStartOffset() {
        val document = DocumentImpl("abcdef")
        val snapshot = PiXIdeSnapshotBuilder.buildSnapshot(
            filePath = "/repo/src/main.kt",
            workspaceFolder = "/repo",
            document = document,
            selections = listOf(
                PiXIdeSnapshotBuilder.OffsetSelection(4, 6),
                PiXIdeSnapshotBuilder.OffsetSelection(1, 3),
            ),
        )

        assertEquals(listOf("bc", "ef"), snapshot.ranges.map { it.text })
    }
}
