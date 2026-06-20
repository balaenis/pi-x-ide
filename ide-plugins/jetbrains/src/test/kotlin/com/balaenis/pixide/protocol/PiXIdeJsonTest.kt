// ABOUTME: Tests JSON-RPC parsing and serialization for the JetBrains pi-x-ide protocol.
// ABOUTME: Verifies initialize response fields stay compatible with Pi's TypeScript client.
package com.balaenis.pixide.protocol

import com.google.gson.JsonParser
import com.google.gson.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class PiXIdeJsonTest {
    @Test
    fun parsesInitializeRequest() {
        val request = PiXIdeJson.parseRequest(
            """
            {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}
            """.trimIndent(),
        )

        assertNotNull(request)
        assertEquals(1, request.id.asInt)
        assertEquals("initialize", request.method)
    }

    @Test
    fun serializesInitializeResponse() {
        val json = PiXIdeJson.response(
            JsonPrimitive(1),
            InitializeResult(
                protocolVersion = PROTOCOL_VERSION,
                server = ServerInfo(name = SERVER_NAME, version = "1.13.1", ide = IDE_SOURCE),
            ),
        )
        val root = JsonParser.parseString(json).asJsonObject
        val result = root.getAsJsonObject("result")
        val server = result.getAsJsonObject("server")

        assertEquals("2.0", root.get("jsonrpc").asString)
        assertEquals(1, root.get("id").asInt)
        assertEquals(1, result.get("protocolVersion").asInt)
        assertEquals("Pi x IDE JetBrains", server.get("name").asString)
        assertEquals("1.13.1", server.get("version").asString)
        assertEquals("jetbrains", server.get("ide").asString)
    }
}
