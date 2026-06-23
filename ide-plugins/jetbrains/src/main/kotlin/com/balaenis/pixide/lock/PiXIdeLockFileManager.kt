// ABOUTME: Manages authenticated pi-x-ide lock files for JetBrains project sessions.
// ABOUTME: Writes protocol-compatible JSON atomically and cleans up only the owned lock file.
package com.balaenis.pixide.lock

import com.balaenis.pixide.protocol.IDE_SOURCE
import com.balaenis.pixide.protocol.IdeLockFile
import com.balaenis.pixide.protocol.LOCK_FILE_EXTENSION
import com.balaenis.pixide.protocol.PiXIdeJson
import com.balaenis.pixide.protocol.PROTOCOL_VERSION
import com.balaenis.pixide.EXT_CONFIG_NAME
import com.balaenis.pixide.protocol.TRANSPORT
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermission
import java.security.SecureRandom
import java.time.Clock
import java.time.Instant
import java.util.Locale

private const val CONFIG_DIR_NAME = ".pi"

class PiXIdeLockFileManager(
    private val lockDir: Path = defaultLockDir(),
    private val processId: Long = ProcessHandle.current().pid(),
    private val clock: Clock = Clock.systemUTC(),
    private val runningInWindows: Boolean = detectRunningInWindows(),
) {
    var currentPath: Path? = null
        private set

    var currentLock: IdeLockFile? = null
        private set

    fun write(port: Int, authToken: String, workspaceFolders: List<String>): IdeLockFile {
        val now = nowIso()
        val lock = IdeLockFile(
            version = PROTOCOL_VERSION,
            ide = IDE_SOURCE,
            name = "Pi x IDE JetBrains",
            transport = TRANSPORT,
            host = "127.0.0.1",
            port = port,
            authToken = authToken,
            workspaceFolders = workspaceFolders.distinct(),
            pid = processId,
            runningInWindows = runningInWindows,
            createdAt = now,
            updatedAt = now,
        )
        val path = lockPath(port)
        writeLockFile(path, lock)
        currentPath = path
        currentLock = lock
        return lock
    }

    fun refresh(workspaceFolders: List<String>): IdeLockFile? {
        val previous = currentLock ?: return null
        val path = currentPath ?: return null
        val refreshed = previous.copy(
            workspaceFolders = workspaceFolders.distinct(),
            updatedAt = nowIso(),
        )
        writeLockFile(path, refreshed)
        currentLock = refreshed
        return refreshed
    }

    fun cleanup() {
        val path = currentPath
        currentPath = null
        currentLock = null
        if (path != null) Files.deleteIfExists(path)
    }

    fun lockPath(port: Int): Path = lockDir.resolve("$IDE_SOURCE-$processId-$port$LOCK_FILE_EXTENSION")

    private fun writeLockFile(path: Path, lock: IdeLockFile) {
        Files.createDirectories(lockDir)
        setDirectoryPermissions(lockDir)

        val tmp = lockDir.resolve("${path.fileName}.${processId}.${System.nanoTime()}.tmp")
        Files.writeString(tmp, PiXIdeJson.prettyJson(lock), StandardCharsets.UTF_8)
        setFilePermissions(tmp)
        try {
            Files.move(tmp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING)
        }
        setFilePermissions(path)
    }

    private fun nowIso(): String = Instant.now(clock).toString()

    companion object {
        private val secureRandom = SecureRandom()

        fun defaultLockDir(): Path = Path.of(System.getProperty("user.home"), CONFIG_DIR_NAME, EXT_CONFIG_NAME, "lock")

        fun detectRunningInWindows(): Boolean =
            System.getProperty("os.name").orEmpty().startsWith("Windows", ignoreCase = true)

        fun createAuthToken(): String {
            val bytes = ByteArray(32)
            secureRandom.nextBytes(bytes)
            return bytes.joinToString("") { String.format(Locale.ROOT, "%02x", it.toInt() and 0xff) }
        }
    }
}

private fun setDirectoryPermissions(path: Path) {
    setPermissions(
        path,
        setOf(
            PosixFilePermission.OWNER_READ,
            PosixFilePermission.OWNER_WRITE,
            PosixFilePermission.OWNER_EXECUTE,
        ),
    )
}

private fun setFilePermissions(path: Path) {
    setPermissions(path, setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE))
}

private fun setPermissions(path: Path, permissions: Set<PosixFilePermission>) {
    try {
        Files.setPosixFilePermissions(path, permissions)
    } catch (_: UnsupportedOperationException) {
        // Non-POSIX filesystem.
    } catch (_: IOException) {
        // Best-effort permissions only.
    }
}
