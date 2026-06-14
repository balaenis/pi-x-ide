import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { IdeWebSocketServer } from "../src/shared/ide-server";
import { AUTH_HEADER } from "../src/shared/protocol";
import { decodeRawData } from "../src/shared/ws";

void test("sends targeted notifications to only one connected client", async () => {
  const server = new IdeWebSocketServer("token", { name: "Test IDE", ide: "vscode" });
  const port = await server.start();
  const clients = await Promise.all([connectClient(port), connectClient(port)]);
  const received = clients.map((client) => collectMessages(client));

  try {
    assert.equal(server.clientCount, 2);

    assert.equal(server.sendToFirstClient({ jsonrpc: "2.0", method: "targeted" }), true);
    await waitFor(() => received[0].length + received[1].length === 1);

    assert.equal(received[0].length + received[1].length, 1);
  } finally {
    for (const client of clients) client.close();
    await server.stop();
  }
});

async function connectClient(port: number): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { [AUTH_HEADER]: "token" } });
  await new Promise<void>((resolve, reject) => {
    client.once("open", resolve);
    client.once("error", reject);
  });
  return client;
}

function collectMessages(client: WebSocket): string[] {
  const messages: string[] = [];
  client.on("message", (raw) => messages.push(decodeRawData(raw)));
  return messages;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("condition was not met before timeout");
}
