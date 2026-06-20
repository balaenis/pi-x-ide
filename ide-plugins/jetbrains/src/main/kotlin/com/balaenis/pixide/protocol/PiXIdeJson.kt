// ABOUTME: Serializes and parses the JSON-RPC messages used by Pi x IDE JetBrains.
// ABOUTME: Keeps JSON field names compatible with the shared TypeScript protocol.
package com.balaenis.pixide.protocol

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonPrimitive

object PiXIdeJson {
    val gson: Gson = GsonBuilder()
        .disableHtmlEscaping()
        .setPrettyPrinting()
        .create()

    fun compactGson(): Gson = GsonBuilder()
        .disableHtmlEscaping()
        .create()

    data class JsonRpcRequest(
        val id: JsonElement,
        val method: String,
        val params: JsonObject? = null,
    )

    data class JsonRpcError(
        val code: Int,
        val message: String,
    )

    data class JsonRpcResponse(
        val jsonrpc: String = "2.0",
        val id: JsonElement,
        val result: Any? = null,
        val error: JsonRpcError? = null,
    )

    data class JsonRpcNotification(
        val jsonrpc: String = "2.0",
        val method: String,
        val params: Any? = null,
    )

    fun parseRequest(text: String): JsonRpcRequest? {
        val obj = runCatching { JsonParser.parseString(text).asJsonObject }.getOrNull() ?: return null
        if (obj.stringValue("jsonrpc") != "2.0") return null
        val id = obj.get("id") ?: return null
        if (!id.isJsonPrimitive || !id.asJsonPrimitive.isStringOrNumber()) return null
        val method = obj.stringValue("method") ?: return null
        val params = obj.get("params")?.takeIf { it.isJsonObject }?.asJsonObject
        return JsonRpcRequest(id = id, method = method, params = params)
    }

    fun response(id: JsonElement, result: Any): String = compactGson().toJson(JsonRpcResponse(id = id, result = result))

    fun errorResponse(id: JsonElement, code: Int, message: String): String =
        compactGson().toJson(JsonRpcResponse(id = id, error = JsonRpcError(code, message)))

    fun notification(method: String, params: Any): String =
        compactGson().toJson(JsonRpcNotification(method = method, params = params))

    fun prettyJson(value: Any): String = "${gson.toJson(value)}\n"

    private fun JsonObject.stringValue(name: String): String? {
        val primitive = get(name)?.takeIf { it.isJsonPrimitive }?.asJsonPrimitive ?: return null
        return if (primitive.isString) primitive.asString else null
    }

    private fun JsonPrimitive.isStringOrNumber(): Boolean = isString || isNumber
}
