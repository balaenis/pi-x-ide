// ABOUTME: Tests WebSocket initialize and authentication behavior for the JetBrains plugin server.
// ABOUTME: Verifies Pi receives initialize plus initial selection-cleared notifications only when authorized.
package com.balaenis.pixide.server

import com.balaenis.pixide.protocol.AUTH_HEADER
import com.google.gson.JsonParser
import java.net.URI
import java.net.http.HttpClient
import java.net.http.WebSocket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class PiXIdeWebSocketServerTest {
    @Test
    fun authorizedClientReceivesInitializeResponseAndInitialSelectionCleared() {
        val server = PiXIdeWebSocketServer(
            authToken = "token",
            pluginVersion = "1.13.1",
            getInitialSelection = { null },
        )
        try {
            val port = server.start()
            val listener = CollectingListener()
            val socket = connect(port, "token", listener)
            socket.sendText(initializeRequest(), true).get(5, TimeUnit.SECONDS)

            val initialize = listener.nextMessage()
            val initial = listener.nextMessage()
            assertNotNull(initialize)
            assertNotNull(initial)

            val response = JsonParser.parseString(initialize).asJsonObject
            assertEquals("2.0", response.get("jsonrpc").asString)
            assertEquals(1, response.get("id").asInt)
            assertEquals("jetbrains", response.getAsJsonObject("result").getAsJsonObject("server").get("ide").asString)

            val notification = JsonParser.parseString(initial).asJsonObject
            assertEquals("selection_cleared", notification.get("method").asString)
            assertEquals("jetbrains", notification.getAsJsonObject("params").get("source").asString)
            assertTrue(server.clientCount >= 1)

            socket.sendClose(WebSocket.NORMAL_CLOSURE, "done").get(5, TimeUnit.SECONDS)
            Thread.sleep(100)
            assertEquals(0, server.clientCount)
        } finally {
            server.stop()
        }
    }

    @Test
    fun unauthorizedClientReceivesNoInitializeResponse() {
        val server = PiXIdeWebSocketServer(
            authToken = "token",
            pluginVersion = "1.13.1",
            getInitialSelection = { null },
        )
        try {
            val port = server.start()
            val listener = CollectingListener()
            val result = runCatching { connect(port, "wrong", listener) }
            if (result.isSuccess) {
                result.getOrThrow().sendText(initializeRequest(), true).get(5, TimeUnit.SECONDS)
                assertEquals(null, listener.messages.poll(500, TimeUnit.MILLISECONDS))
            }
            assertEquals(0, server.clientCount)
        } finally {
            server.stop()
        }
    }

    private fun connect(port: Int, token: String, listener: CollectingListener): WebSocket =
        HttpClient.newHttpClient()
            .newWebSocketBuilder()
            .header(AUTH_HEADER, token)
            .buildAsync(URI.create("ws://127.0.0.1:$port"), listener)
            .get(5, TimeUnit.SECONDS)

    private fun initializeRequest(): String =
        """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"client":{"name":"pi-x-ide","version":"test"},"cwd":"/repo"}}"""

    class CollectingListener : WebSocket.Listener {
        val messages = LinkedBlockingQueue<String>()

        override fun onOpen(webSocket: WebSocket) {
            webSocket.request(1)
        }

        override fun onText(webSocket: WebSocket, data: CharSequence, last: Boolean): CompletableFuture<*> {
            messages.offer(data.toString())
            webSocket.request(1)
            return CompletableFuture.completedFuture(null)
        }

        fun nextMessage(): String? = messages.poll(5, TimeUnit.SECONDS)
    }
}
