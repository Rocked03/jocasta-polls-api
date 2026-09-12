import type { Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

import { verifyBotServiceToken } from "@/auth/botServiceToken";
import { setBroadcastFn } from "./botEventEmitter";

const BOT_EVENTS_PATH = "/api/v1/bot/events";
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 5_000;

interface BotClient {
  ws: WebSocket;
  lastPong: number;
}

export interface BotEventsServerOptions {
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
}

export function attachBotEventsServer(
  server: Server,
  options: BotEventsServerOptions = {},
): void {
  const pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
  const pongTimeoutMs = options.pongTimeoutMs ?? PONG_TIMEOUT_MS;

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<BotClient>();

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== BOT_EVENTS_PATH) return;

    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ") || !verifyBotServiceToken(auth.slice(7))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: BotClient = { ws, lastPong: Date.now() };
      clients.add(client);
      ws.on("pong", () => {
        client.lastPong = Date.now();
      });
      ws.on("close", () => clients.delete(client));
      ws.send(JSON.stringify({ type: "connected" }));
    });
  });

  setBroadcastFn((frame) => {
    const data = JSON.stringify(frame);
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(data);
    }
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const client of clients) {
      if (now - client.lastPong > pingIntervalMs + pongTimeoutMs) {
        client.ws.terminate();
        clients.delete(client);
        continue;
      }
      client.ws.ping();
    }
  }, pingIntervalMs);

  server.on("close", () => {
    clearInterval(heartbeat);
    for (const client of clients) client.ws.terminate();
    clients.clear();
    wss.close();
  });
}
