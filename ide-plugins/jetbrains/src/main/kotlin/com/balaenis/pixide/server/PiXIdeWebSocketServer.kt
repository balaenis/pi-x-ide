// ABOUTME: Hosts the local authenticated WebSocket server for JetBrains-to-Pi communication.
// ABOUTME: Handles JSON-RPC initialize requests and broadcasts selection and attach notifications.
package com.balaenis.pixide.server

import com.balaenis.pixide.protocol.AUTH_HEADER
import com.balaenis.pixide.protocol.AtMentionedParams
import com.balaenis.pixide.protocol.EditorSelectionSnapshot
import com.balaenis.pixide.protocol.IDE_SOURCE
import com.balaenis.pixide.protocol.InitializeResult
import com.balaenis.pixide.protocol.PiXIdeJson
import com.balaenis.pixide.protocol.PROTOCOL_VERSION
import com.balaenis.pixide.protocol.SERVER_NAME
import com.balaenis.pixide.protocol.SelectionClearedParams
import com.balaenis.pixide.protocol.ServerInfo
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.java_websocket.WebSocket
import org.java_websocket.drafts.Draft
import org.java_websocket.exceptions.InvalidDataException
import org.java_websocket.framing.CloseFrame
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.handshake.ServerHandshakeBuilder
import org.java_websocket.server.WebSocketServer

class PiXIdeWebSocketServer(
    private val authToken: String,
    private val pluginVersion: String,
    private val getInitialSelection: () -> EditorSelectionSnapshot?,
    private val onClientCountChanged: () -> Unit = {},
    private val nowMillis: () -> Long = { System.currentTimeMillis() },
) {
    private val sockets = CopyOnWriteArraySet<WebSocket>()
    private val started = AtomicBoolean(false)
    private var delegate: JetBrainsWebSocketServer? = null
    @Volatile private var startError: Exception? = null

    val port: Int
        get() = delegate?.port ?: 0

    val clientCount: Int
        get() = sockets.count { it.isOpen }

    val isRunning: Boolean
        get() = started.get() && delegate != null

    fun start(): Int {
        if (started.get()) return port
        val latch = CountDownLatch(1)
        val server = JetBrainsWebSocketServer(latch)
        delegate = server
        server.isReuseAddr = false
        server.isDaemon = true
        server.start()
        if (!latch.await(10, TimeUnit.SECONDS)) {
            stop()
            throw IllegalStateException("Timed out while starting Pi x IDE JetBrains WebSocket server")
        }
        startError?.let {
            stop()
            throw it
        }
        started.set(true)
        return server.port
    }

    fun broadcastNotification(method: String, params: Any) {
        val text = PiXIdeJson.notification(method, params)
        for (socket in sockets.filter { it.isOpen }) sendText(socket, text)
    }

    fun sendAtMentioned(snapshot: EditorSelectionSnapshot, rangeText: String): Boolean {
        val openSockets = sockets.filter { it.isOpen }
        if (openSockets.isEmpty()) return false
        val text = PiXIdeJson.notification(
            "at_mentioned",
            AtMentionedParams(snapshot.copy(receivedAt = snapshot.receivedAt ?: nowMillis()), rangeText),
        )
        var sent = false
        for (socket in openSockets) sent = sendText(socket, text) || sent
        return sent
    }

    fun stop() {
        val server = delegate
        delegate = null
        started.set(false)
        for (socket in sockets) runCatching { socket.close() }
        sockets.clear()
        if (server != null) runCatching { server.stop(1000) }
        onClientCountChanged()
    }

    private fun handleMessage(socket: WebSocket, text: String) {
        val request = PiXIdeJson.parseRequest(text) ?: return
        if (request.method != "initialize") return
        val result = InitializeResult(
            protocolVersion = PROTOCOL_VERSION,
            server = ServerInfo(
                name = SERVER_NAME,
                version = pluginVersion,
                ide = IDE_SOURCE,
            ),
        )
        sendText(socket, PiXIdeJson.response(request.id, result))

        val snapshot = getInitialSelection()?.copy(receivedAt = nowMillis())
        val params = snapshot ?: SelectionClearedParams(receivedAt = nowMillis())
        sendText(socket, PiXIdeJson.notification(if (snapshot != null) "selection_changed" else "selection_cleared", params))
    }

    private fun sendText(socket: WebSocket, text: String): Boolean = try {
        socket.send(text)
        true
    } catch (_: RuntimeException) {
        sockets.remove(socket)
        runCatching { socket.close() }
        onClientCountChanged()
        false
    }

    private inner class JetBrainsWebSocketServer(
        private val startLatch: CountDownLatch,
    ) : WebSocketServer(InetSocketAddress("127.0.0.1", 0)) {
        override fun onStart() {
            connectionLostTimeout = 0
            connectionLostTimeout = 100
            startLatch.countDown()
        }

        override fun onWebsocketHandshakeReceivedAsServer(
            conn: WebSocket,
            draft: Draft,
            request: ClientHandshake,
        ): ServerHandshakeBuilder {
            val token = request.getFieldValue(AUTH_HEADER)
            if (token != authToken) {
                throw InvalidDataException(CloseFrame.POLICY_VALIDATION, "Unauthorized")
            }
            return super.onWebsocketHandshakeReceivedAsServer(conn, draft, request)
        }

        override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
            sockets.add(conn)
            onClientCountChanged()
        }

        override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
            sockets.remove(conn)
            onClientCountChanged()
        }

        override fun onMessage(conn: WebSocket, message: String) {
            handleMessage(conn, message)
        }

        override fun onMessage(conn: WebSocket, message: ByteBuffer) {
            handleMessage(conn, Charsets.UTF_8.decode(message).toString())
        }

        override fun onError(conn: WebSocket?, ex: Exception) {
            if (conn != null) sockets.remove(conn)
            if (!started.get()) startError = ex
            startLatch.countDown()
            onClientCountChanged()
        }
    }
}
