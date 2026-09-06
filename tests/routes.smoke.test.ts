import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "@/app";

let app: Express;

beforeAll(async () => {
  app = await createApp();
});

const stubs: Array<{ method: "get" | "post"; path: string }> = [
  // publish/end/crosspost were implemented in the lifecycle layer; they
  // now 404 on a missing poll instead of 501 (covered in lifecycle.test.ts)
  { method: "get", path: "/api/v1/bot/tags" },
  { method: "get", path: "/api/v1/bot/tags/comic" },
  { method: "post", path: "/api/v1/bot/tags/create" },
  { method: "post", path: "/api/v1/bot/tags/update" },
  { method: "get", path: "/api/v1/bot/guilds/281648235557421056" },
  { method: "get", path: "/api/v1/bot/discord/guilds/281648235557421056/channels" },
  { method: "get", path: "/api/v1/bot/discord/guilds/281648235557421056/roles" },
  { method: "get", path: "/api/v1/bot/events" },
];

describe.each(stubs)("stub $method $path", ({ method, path }) => {
  it("returns 501 with a message", async () => {
    const response = await request(app)[method](path).set(
      "Authorization",
      `Bearer ${process.env.BOT_SERVICE_TOKEN}`,
    );
    expect(response.status).toBe(501);
    expect(response.body).toEqual({ message: "Not implemented" });
  });
});

describe("health", () => {
  it("returns 200 ok", async () => {
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

describe("router chain", () => {
  it("still 404s unknown paths", async () => {
    const response = await request(app).get("/api/v1/definitely-not-a-route");
    expect(response.status).toBe(404);
  });
});
