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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import WebSocket from "ws";
import type { RawData, WebSocket as WsClient } from "ws";

import { createApp } from "@/app";
import { runBotContext } from "@/context/botContext";
import { crosspostPoll, endPoll, publishPoll } from "@/services/pollLifecycleService";
import {
  createPolls,
  deletePolls,
  updatePolls,
  updatePollsByTag,
} from "@/services/pollWriteService";
import { createTag, updateTag } from "@/services/tagService";
import { castVote } from "@/services/voteService";
import type { PollWriteInput } from "@/utils/validatePoll";
import { emitBotEvent } from "@/websocket/botEventEmitter";
import { attachBotEventsServer } from "@/websocket/botEventsServer";
import {
  FIXTURE_GUILD_ID,
  FIXTURE_POLLS,
  FIXTURE_TAGS,
  FIXTURE_USER_ID,
  FIXTURE_VOTES,
  type FixturePoll,
  type FixtureTag,
  type FixtureVote,
} from "./fixtures";

const TOKEN = process.env.BOT_SERVICE_TOKEN!;

// The service-emission describe drives REAL service functions, whose
// fixture-prisma write delegates mutate the fixture arrays in place;
// pristine copies are captured at import (before any mutation) and
// restored before each of its tests.
const PRISTINE_POLLS: FixturePoll[] = FIXTURE_POLLS.map((poll) => ({
  ...poll,
}));
const PRISTINE_VOTES: FixtureVote[] = FIXTURE_VOTES.map((vote) => ({
  ...vote,
}));
const PRISTINE_TAGS: FixtureTag[] = FIXTURE_TAGS.map((tag) => ({
  ...tag,
}));

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

  it("destroys the socket on a malformed request-target without crashing the server", async () => {
    const net = await import("node:net");
    const port = (server.address() as AddressInfo).port;
    const result = await new Promise<string>((resolve) => {
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write(
          "GET // HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
        );
      });
      sock.on("close", () => resolve("closed"));
      sock.on("error", () => resolve("errored"));
      setTimeout(() => resolve("timeout"), 2000);
    });
    expect(result).not.toBe("timeout");

    // The server must still be alive and accepting valid connections
    await connectAndHandshake(baseUrl);
  });

  it("destroys the socket on a non-events upgrade path (no dangling sockets)", async () => {
    const net = await import("node:net");
    const port = (server.address() as AddressInfo).port;
    const result = await new Promise<string>((resolve) => {
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write(
          "GET /api/v1/bot/other HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
        );
      });
      sock.on("close", () => resolve("closed"));
      sock.on("error", () => resolve("errored"));
      setTimeout(() => resolve("timeout"), 2000);
    });
    expect(result).not.toBe("timeout");
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

describe("service write emission (real service calls end-to-end)", () => {
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

  beforeEach(() => {
    FIXTURE_POLLS.length = 0;
    FIXTURE_POLLS.push(...PRISTINE_POLLS.map((poll) => ({ ...poll })));
    FIXTURE_VOTES.length = 0;
    FIXTURE_VOTES.push(...PRISTINE_VOTES.map((vote) => ({ ...vote })));
    FIXTURE_TAGS.length = 0;
    FIXTURE_TAGS.push(...PRISTINE_TAGS.map((tag) => ({ ...tag })));
  });

  /** Update-route-shaped input (validatePoll requires the base fields). */
  function updateInput(id: number, overrides: Partial<PollWriteInput> = {}) {
    return {
      id,
      question: `Q${id}`,
      choices: ["choice 0", "choice 1"],
      ...overrides,
    };
  }

  /** A frame that never arrives must not hang the test: wait past any
   * plausible send, then assert the client's buffer is empty. */
  async function expectNoFrame(ws: WsClient): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(messageQueues.get(ws)).toEqual([]);
  }

  it("web write: a real updatePolls call (no ALS context) delivers the frame", async () => {
    const ws = await connectAndHandshake(baseUrl);

    await updatePolls([updateInput(3, { question: "web edited" })]);

    expect(await nextMessage(ws)).toBe('{"table":"polls","operation":"update","id":3}');
  });

  it("bot write: the same service call inside runBotContext delivers nothing", async () => {
    const ws = await connectAndHandshake(baseUrl);

    await runBotContext(
      { isBotCall: true, userId: "123", managementOverride: true },
      () => updatePolls([updateInput(3, { question: "bot edited" })]),
    );

    await expectNoFrame(ws);

    // Sentinel web write: the connection still works, and only this
    // frame arrives — the bot write emitted nothing, not a late frame.
    await updatePolls([updateInput(3)]);
    expect(await nextMessage(ws)).toBe('{"table":"polls","operation":"update","id":3}');
    await expectNoFrame(ws);
  });

  it("castVote emits the poll id as parent (create, update, and delete paths)", async () => {
    const ws = await connectAndHandshake(baseUrl);

    // P4 has no USER vote -> create path; the vote row id is a huge
    // bigint encoding, the frame must carry the poll id instead.
    await castVote(4, FIXTURE_USER_ID, 1);
    expect(await nextMessage(ws)).toBe('{"table":"votes","operation":"create","id":4}');

    // P1 has an existing USER vote (choice 0) -> update path
    await castVote(1, FIXTURE_USER_ID, 1);
    expect(await nextMessage(ws)).toBe('{"table":"votes","operation":"update","id":1}');

    // ...and null choice deletes it -> delete path
    await castVote(1, FIXTURE_USER_ID, null);
    expect(await nextMessage(ws)).toBe('{"table":"votes","operation":"delete","id":1}');

    // No-op delete (no vote to delete) changes nothing: no frame.
    await castVote(1, FIXTURE_USER_ID, null);
    await expectNoFrame(ws);
  });

  it("lifecycle writes each emit a polls update frame", async () => {
    const ws = await connectAndHandshake(baseUrl);

    await publishPoll(3, { message_id: 777n, crosspost_message_ids: [] });
    expect(await nextMessage(ws)).toBe('{"table":"polls","operation":"update","id":3}');

    // P2 has a null end_time, so endPoll takes its write path (P4/P5
    // ship a set end_time and would return early without writing).
    await endPoll(2);
    expect(await nextMessage(ws)).toBe('{"table":"polls","operation":"update","id":2}');

    await crosspostPoll(1, 888n);
    expect(await nextMessage(ws)).toBe('{"table":"polls","operation":"update","id":1}');

    // Idempotent no-ops write nothing, so they emit nothing: P1 is
    // already published, P5 already ended.
    await publishPoll(1, { message_id: 999n, crosspost_message_ids: [] });
    await endPoll(5);
    await expectNoFrame(ws);
  });

  it("tag create and update emit their frames", async () => {
    const ws = await connectAndHandshake(baseUrl);

    const created = await createTag({
      name: "ws emission tag",
      guild_id: FIXTURE_GUILD_ID,
      channel_id: 101n,
    });
    const raw = await nextMessage(ws);
    expect(JSON.parse(raw)).toEqual({
      table: "tags",
      operation: "create",
      id: created.tag,
    });

    await updateTag(1, { name: "renamed" });
    expect(await nextMessage(ws)).toBe('{"table":"tags","operation":"update","id":1}');
  });

  it("bulk writes emit one frame per poll, not one for the batch", async () => {
    const ws = await connectAndHandshake(baseUrl);

    const created = await createPolls([
      { question: "bulk a", choices: ["a", "b"], guild_id: FIXTURE_GUILD_ID, tag: 1 },
      { question: "bulk b", choices: ["a", "b"], guild_id: FIXTURE_GUILD_ID, tag: 1 },
    ]);
    const createdIds = created.map((poll) => poll.id);
    expect(JSON.parse(await nextMessage(ws))).toEqual({
      table: "polls",
      operation: "create",
      id: createdIds[0],
    });
    expect(JSON.parse(await nextMessage(ws))).toEqual({
      table: "polls",
      operation: "create",
      id: createdIds[1],
    });

    // tag 2 = P3 + P4
    const updated = await updatePollsByTag(2, { question: "renamed" });
    const updatedIds = (await Promise.all([
      nextMessage(ws),
      nextMessage(ws),
    ])).map((raw) => JSON.parse(raw).id);
    expect(updatedIds.sort()).toEqual(
      updated.map((poll) => poll.id).sort(),
    );

    await deletePolls(["3"]);
    expect(await nextMessage(ws)).toBe('{"table":"polls","operation":"delete","id":3}');
  });

  it("failed writes emit nothing (a throw skips the emit)", async () => {
    const ws = await connectAndHandshake(baseUrl);

    // Matrix violation: choices length is frozen on a published poll.
    await expect(
      updatePolls([updateInput(1, { choices: ["a", "b", "c"] })]),
    ).rejects.toThrow(
      "Cannot change the number of choices for a published poll",
    );
    await expectNoFrame(ws);

    // Sentinel: the pipeline still delivers after the failure.
    await updatePolls([updateInput(3)]);
    expect(await nextMessage(ws)).toBe('{"table":"polls","operation":"update","id":3}');
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
