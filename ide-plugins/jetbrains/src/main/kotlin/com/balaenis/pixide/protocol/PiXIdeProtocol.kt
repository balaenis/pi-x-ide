// ABOUTME: Defines Kotlin data classes and constants for the pi-x-ide JSON-RPC protocol.
// ABOUTME: Mirrors the TypeScript protocol used by Pi, VS Code, Zed, and Neovim integrations.
package com.balaenis.pixide.protocol

const val PROTOCOL_VERSION = 1
const val AUTH_HEADER = "x-pi-x-ide-authorization"
const val IDE_SOURCE = "jetbrains"
const val TRANSPORT = "ws"
const val LOCK_FILE_EXTENSION = ".lock"
const val SERVER_NAME = "Pi x IDE JetBrains"

data class Position(
    val line: Int,
    val character: Int,
)

data class ProtocolRange(
    val start: Position,
    val end: Position,
)

data class SelectionRange(
    val text: String,
    val selection: ProtocolRange,
)

data class EditorSelectionSnapshot(
    val source: String = IDE_SOURCE,
    val filePath: String,
    val workspaceFolder: String? = null,
    val ranges: List<SelectionRange>,
    val receivedAt: Long? = null,
)

data class SelectionClearedParams(
    val source: String = IDE_SOURCE,
    val reason: String = "no-active-editor",
    val receivedAt: Long? = null,
)

data class AtMentionedParams(
    val source: String = IDE_SOURCE,
    val filePath: String,
    val workspaceFolder: String? = null,
    val ranges: List<SelectionRange>,
    val rangeText: String,
    val receivedAt: Long? = null,
) {
    constructor(snapshot: EditorSelectionSnapshot, rangeText: String) : this(
        source = snapshot.source,
        filePath = snapshot.filePath,
        workspaceFolder = snapshot.workspaceFolder,
        ranges = snapshot.ranges,
        rangeText = rangeText,
        receivedAt = snapshot.receivedAt,
    )
}

data class ServerInfo(
    val name: String,
    val version: String? = null,
    val ide: String = IDE_SOURCE,
)

data class InitializeResult(
    val protocolVersion: Int = PROTOCOL_VERSION,
    val server: ServerInfo,
)

data class IdeLockFile(
    val version: Int = PROTOCOL_VERSION,
    val ide: String = IDE_SOURCE,
    val name: String,
    val transport: String = TRANSPORT,
    val host: String,
    val port: Int,
    val authToken: String,
    val workspaceFolders: List<String>,
    val pid: Long,
    val createdAt: String,
    val updatedAt: String,
)
