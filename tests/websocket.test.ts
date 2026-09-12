/**
 * Bot events WebSocket channel: a real HTTP server on an ephemeral port
 * with real ws clients (supertest cannot drive upgrades). Covers the
 * upgrade auth matrix (valid Bearer -> {type:"connected"} handshake
 * frame; missing/malformed/wrong credentials -> HTTP 401 rejection),
 * frame delivery with the locked {table, operation, id} wire shape,
 * ALS suppression for bot-originated writes, multi-client fan-out and
 * disconnect cleanup. The heartbeat runs on a SECOND server with short
 * interval overrides (defaults are locked at 15s/5s): a paused client
 * stops reading so its pings go unanswered and the server must
 * terminate it, while the auto-ponging client survives and keeps
 * receiving frames. That describe runs last because the broadcast fn
 * is a module-level singleton the second attach overwrites.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import WebSocket from "ws";
import type { RawData, WebSocket as WsClient } from "ws";

import { createApp } from "@/app";
import { runBotContext } from "@/context/botContext";
import { emitBotEvent } from "@/websocket/botEventEmitter";
import { attachBotEventsServer } from "@/websocket/botEventsServer";

const TOKEN = process.env.BOT_SERVICE_TOKEN!;

const openedClients: WsClient[] = [];
const messageQueues = new Map<WsClient, string[]>();
const messageWaiters = new Map<WsClient, Array<(raw: string) => void>>();

function connect(baseUrl: string, headers: Record<string, string> = {}): WsClient {
  const ws = new WebSocket(`ws://${baseUrl}/api/v1/bot/events`, { headers });
  messageQueues.set(ws, []);
  messageWaiters.set(ws, []);
  ws.on("message", (data: RawData) => {
    const raw = data.toString();
    const waiter = messageWaiters.get(ws)!.shift();
    if (waiter) waiter(raw);
    else messageQueues.get(ws)!.push(raw);
  });
  openedClients.push(ws);
  return ws;
}

function waitForOpen(ws: WsClient): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (error: Error) => reject(error));
    ws.once("unexpected-response", (_req, res) =>
      reject(new Error(`unexpected response ${res.statusCode}`)),
    );
  });
}

function waitForStatus(ws: WsClient): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode!));
    ws.once("open", () => reject(new Error("connection unexpectedly succeeded")));
  });
}

function nextMessage(ws: WsClient): Promise<string> {
  const buffered = messageQueues.get(ws)!.shift();
  if (buffered !== undefined) return Promise.resolve(buffered);
  return new Promise((resolve, reject) => {
    messageWaiters.get(ws)!.push(resolve);
    ws.once("close", (code: number) =>
      reject(new Error(`closed before message (${code})`)),
    );
  });
}

async function connectAndHandshake(baseUrl: string): Promise<WsClient> {
  const ws = connect(baseUrl, { Authorization: `Bearer ${TOKEN}` });
  await waitForOpen(ws);
  expect(await nextMessage(ws)).toEqual('{"type":"connected"}');
  return ws;
}

describe("bot events websocket", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await createApp();
    server = createServer(app);
    attachBotEventsServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const ws of openedClients) {
      if (ws.readyState !== WebSocket.CONNECTING) ws.terminate();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("completes the handshake for a valid Bearer token", async () => {
    await connectAndHandshake(baseUrl);
  });

  it("rejects the upgrade with HTTP 401 for a wrong token", async () => {
    const ws = connect(baseUrl, { Authorization: "Bearer wrong-token" });
    expect(await waitForStatus(ws)).toBe(401);
  });

  it("rejects the upgrade with HTTP 401 without an Authorization header", async () => {
    const ws = connect(baseUrl);
    expect(await waitForStatus(ws)).toBe(401);
  });

  it("rejects the upgrade with HTTP 401 for a non-Bearer scheme", async () => {
    const ws = connect(baseUrl, { Authorization: `Basic ${TOKEN}` });
    expect(await waitForStatus(ws)).toBe(401);
  });

  it("delivers emitBotEvent frames with the locked shape (no ALS context = web write)", async () => {
    const ws = await connectAndHandshake(baseUrl);

    emitBotEvent("polls", "update", 123);

    const raw = await nextMessage(ws);
    expect(raw).toBe('{"table":"polls","operation":"update","id":123}');
    expect(JSON.parse(raw)).toEqual({
      table: "polls",
      operation: "update",
      id: 123,
    });
  });

  it("suppresses frames for bot-originated writes (ALS isBotCall)", async () => {
    const ws = await connectAndHandshake(baseUrl);

    emitBotEvent("polls", "update", 1);
    runBotContext(
      { isBotCall: true, userId: undefined, managementOverride: true },
      () => {
        emitBotEvent("votes", "create", 2);
      },
    );
    emitBotEvent("tags", "delete", 3);

    expect(await nextMessage(ws)).toBe('{"table":"polls","operation":"update","id":1}');
    expect(await nextMessage(ws)).toBe('{"table":"tags","operation":"delete","id":3}');
  });

  it("fans out frames to multiple clients", async () => {
    const a = await connectAndHandshake(baseUrl);
    const b = await connectAndHandshake(baseUrl);

    emitBotEvent("votes", "create", 42);

    expect(await nextMessage(a)).toBe('{"table":"votes","operation":"create","id":42}');
    expect(await nextMessage(b)).toBe('{"table":"votes","operation":"create","id":42}');
  });

  it("removes disconnected clients (subsequent broadcasts do not throw)", async () => {
    const a = await connectAndHandshake(baseUrl);
    const b = await connectAndHandshake(baseUrl);

    a.close();
    await new Promise<void>((resolve) => a.once("close", () => resolve()));

    emitBotEvent("polls", "create", 7);
    expect(await nextMessage(b)).toBe('{"table":"polls","operation":"create","id":7}');
  });
});

describe("bot events heartbeat", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await createApp();
    server = createServer(app);
    attachBotEventsServer(server, { pingIntervalMs: 40, pongTimeoutMs: 120 });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const ws of openedClients) {
      if (ws.readyState !== WebSocket.CONNECTING) ws.terminate();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("terminates a client that stops ponging; a ponging client survives", async () => {
    const healthy = await connectAndHandshake(baseUrl);
    const dead = await connectAndHandshake(baseUrl);

    // A paused client stops reading: the server's pings queue up
    // unanswered. The pause also hides the server-side termination
    // until resumed (the pending FIN is only processed on resume), so
    // the close assertion happens after a wait well past the
    // pingInterval + pongTimeout termination threshold.
    dead.pause();
    await new Promise((resolve) => setTimeout(resolve, 600));
    dead.resume();

    const closed = new Promise<number>((resolve) => {
      dead.once("close", (code: number) => resolve(code));
    });
    const code = await Promise.race([
      closed,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("dead client was not terminated")), 3000),
      ),
    ]);
    expect(code).toBe(1006);
    expect(dead.readyState).toBe(WebSocket.CLOSED);

    expect(healthy.readyState).toBe(WebSocket.OPEN);
    emitBotEvent("tags", "update", 9);
    expect(await nextMessage(healthy)).toBe('{"table":"tags","operation":"update","id":9}');
  });
});
