// ABOUTME: Tests JetBrains pi-x-ide lock-file generation, JSON shape, refresh, and cleanup.
// ABOUTME: Ensures Pi can discover and parse the lock files written by the plugin.
package com.balaenis.pixide.lock

import com.google.gson.JsonParser
import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class PiXIdeLockFileManagerTest {
    @Test
    fun createsLowercaseHexAuthToken() {
        val token = PiXIdeLockFileManager.createAuthToken()
        assertEquals(64, token.length)
        assertTrue(token.matches(Regex("[0-9a-f]{64}")))
    }

    @Test
    fun writesProtocolCompatibleLockFileAndRefreshesIt() {
        val dir = Files.createTempDirectory("pi-x-ide-lock-test-")
        val clock = Clock.fixed(Instant.parse("2026-06-21T00:00:00Z"), ZoneOffset.UTC)
        val manager = PiXIdeLockFileManager(lockDir = dir, processId = 12345, clock = clock)
        val lock = manager.write(48123, "a".repeat(64), listOf("/repo", "/repo"))
        val path = manager.currentPath

        assertNotNull(path)
        assertEquals(dir.resolve("jetbrains-12345-48123.lock"), path)
        assertTrue(Files.exists(path))
        assertEquals(lock, manager.currentLock)

        val root = JsonParser.parseString(Files.readString(path)).asJsonObject
        assertEquals(1, root.get("version").asInt)
        assertEquals("jetbrains", root.get("ide").asString)
        assertEquals("Pi x IDE JetBrains", root.get("name").asString)
        assertEquals("ws", root.get("transport").asString)
        assertEquals("127.0.0.1", root.get("host").asString)
        assertEquals(48123, root.get("port").asInt)
        assertEquals("a".repeat(64), root.get("authToken").asString)
        assertEquals(1, root.getAsJsonArray("workspaceFolders").size())
        assertEquals("/repo", root.getAsJsonArray("workspaceFolders")[0].asString)
        assertFalse(root.get("runningInWindows").asBoolean)

        manager.refresh(listOf("/repo", "/repo/pkg"))
        val refreshed = JsonParser.parseString(Files.readString(path)).asJsonObject
        assertEquals("/repo/pkg", refreshed.getAsJsonArray("workspaceFolders")[1].asString)
        assertEquals(root.get("createdAt").asString, refreshed.get("createdAt").asString)

        manager.cleanup()
        assertFalse(Files.exists(path))
        manager.cleanup()
    }

    @Test
    fun setsRunningInWindowsWhenSeededAsWindows() {
        val dir = Files.createTempDirectory("pi-x-ide-lock-test-")
        val manager = PiXIdeLockFileManager(lockDir = dir, processId = 12345, runningInWindows = true)
        manager.write(48124, "b".repeat(64), listOf("/repo"))
        val path = manager.currentPath
        assertNotNull(path)

        val root = JsonParser.parseString(Files.readString(path)).asJsonObject
        assertTrue(root.get("runningInWindows").asBoolean)
        manager.cleanup()
    }

    @Test
    fun setsRunningInWindowsFalseWhenSeededAsNonWindows() {
        val dir = Files.createTempDirectory("pi-x-ide-lock-test-")
        val manager = PiXIdeLockFileManager(lockDir = dir, processId = 12345, runningInWindows = false)
        manager.write(48125, "c".repeat(64), listOf("/repo"))
        val path = manager.currentPath
        assertNotNull(path)

        val root = JsonParser.parseString(Files.readString(path)).asJsonObject
        assertFalse(root.get("runningInWindows").asBoolean)
        manager.cleanup()
    }
}
