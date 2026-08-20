// ABOUTME: Tests the JetBrains Swing lock-file heartbeat restore and terminal disposal.
// ABOUTME: Verifies external-deletion recovery and post-disposal inactivity through the public helper.
package com.balaenis.pixide.lock

import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull

private const val TEST_HEARTBEAT_INTERVAL_MS = 40
private const val TEST_HEARTBEAT_POLL_MS = 10
private const val TEST_HEARTBEAT_TIMEOUT_MS = 2_000
private const val TEST_LOCK_PORT = 48126
private const val TEST_PROCESS_ID = 12345L

class PiXIdeLockFileHeartbeatTest {
    @Test
    fun restoresDeletedLockUntilSynchronouslyDisposed() {
        val dir = Files.createTempDirectory("pi-x-ide-heartbeat-")
        val clock = Clock.fixed(Instant.parse("2026-06-21T00:00:00Z"), ZoneOffset.UTC)
        val manager = PiXIdeLockFileManager(lockDir = dir, processId = TEST_PROCESS_ID, clock = clock)
        val workspaceFolders = listOf("/repo")
        val written = manager.write(TEST_LOCK_PORT, "d".repeat(64), workspaceFolders)
        val path = manager.currentPath
        assertNotNull(path)

        Files.delete(path)
        assertFalse(Files.exists(path))

        val heartbeat = PiXIdeLockFileHeartbeat(TEST_HEARTBEAT_INTERVAL_MS) {
            manager.refresh(workspaceFolders)
        }
        heartbeat.start()
        try {
            waitUntil { Files.exists(path) }
            val restored = manager.currentLock
            assertNotNull(restored)
            assertEquals(path, manager.currentPath)
            assertEquals(written.port, restored.port)
            assertEquals(written.pid, restored.pid)
            assertEquals(written.authToken, restored.authToken)
            assertEquals(written.createdAt, restored.createdAt)
            assertEquals(workspaceFolders, restored.workspaceFolders)
        } finally {
            heartbeat.dispose()
        }

        manager.cleanup()
        heartbeat.start()
        Thread.sleep((TEST_HEARTBEAT_INTERVAL_MS * 2 + TEST_HEARTBEAT_POLL_MS).toLong())
        assertFalse(Files.exists(path))
    }

    private fun waitUntil(timeoutMs: Int = TEST_HEARTBEAT_TIMEOUT_MS, predicate: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (predicate()) return
            Thread.sleep(TEST_HEARTBEAT_POLL_MS.toLong())
        }
        throw AssertionError("Timed out waiting for JetBrains lock heartbeat")
    }
}
