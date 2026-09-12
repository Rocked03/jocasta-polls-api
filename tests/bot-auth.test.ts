import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "@/app";

let app: Express;
const TOKEN = process.env.BOT_SERVICE_TOKEN!;

beforeAll(async () => {
  app = await createApp();
});

describe("bot service token auth", () => {
  it("passes a valid token through the gate (200 from the tag list)", async () => {
    const response = await request(app)
      .get("/api/v1/bot/tags")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
  });

  it("rejects a missing Authorization header with 401", async () => {
    const response = await request(app).get("/api/v1/bot/polls");
    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message");
  });

  it("rejects a non-Bearer scheme with 401", async () => {
    const response = await request(app)
      .get("/api/v1/bot/polls")
      .set("Authorization", `Token ${TOKEN}`);
    expect(response.status).toBe(401);
  });

  it("rejects a wrong token with 401", async () => {
    const response = await request(app)
      .get("/api/v1/bot/polls")
      .set("Authorization", "Bearer wrong-token");
    expect(response.status).toBe(401);
  });

  it("rejects a short junk token with 401 (no throw)", async () => {
    const response = await request(app)
      .get("/api/v1/bot/polls")
      .set("Authorization", "Bearer x");
    expect(response.status).toBe(401);
  });

  it("rejects a malformed X-Discord-User-Id with 400", async () => {
    const response = await request(app)
      .get("/api/v1/bot/polls")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", "not-a-number");
    expect(response.status).toBe(400);
  });

  it("accepts a snowflake X-Discord-User-Id (still 200)", async () => {
    const response = await request(app)
      .get("/api/v1/bot/tags")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", "281648235557421056");
    expect(response.status).toBe(200);
  });

  it("returns 503 when no token is configured", async () => {
    const previous = process.env.BOT_SERVICE_TOKEN;
    delete process.env.BOT_SERVICE_TOKEN;
    try {
      const response = await request(app)
        .get("/api/v1/bot/polls")
        .set("Authorization", "Bearer anything");
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ message: "Bot authentication not configured" });
    } finally {
      process.env.BOT_SERVICE_TOKEN = previous;
    }
  });

  it("leaves /health unauthenticated", async () => {
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
  });

  it("leaves web routes outside the bot tree", async () => {
    const response = await request(app).get("/api/v1/polls");
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(503);
  });
});
