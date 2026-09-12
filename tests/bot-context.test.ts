import { beforeAll, describe, expect, it } from "vitest";
import express, { Express } from "express";
import request from "supertest";

import { requireBotServiceToken } from "@/middleware/requireBotServiceToken";
import { getBotContext } from "@/context/botContext";

let app: Express;

beforeAll(() => {
  app = express();
  app.use(requireBotServiceToken);
  app.get("/probe", (_req, res) => {
    const context = getBotContext();
    res.json(context ? { ...context, userId: context.userId ?? null } : null);
  });
});

describe("bot context population", () => {
  it("stores the bot context with a user id header", async () => {
    const response = await request(app)
      .get("/probe")
      .set("Authorization", `Bearer ${process.env.BOT_SERVICE_TOKEN}`)
      .set("X-Discord-User-Id", "281648235557421056");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      isBotCall: true,
      userId: "281648235557421056",
      managementOverride: true,
    });
  });

  it("stores the bot context without a user id header (system operation)", async () => {
    const response = await request(app)
      .get("/probe")
      .set("Authorization", `Bearer ${process.env.BOT_SERVICE_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      isBotCall: true,
      userId: null,
      managementOverride: true,
    });
  });

  it("does not expose the context outside the ALS run scope", async () => {
    expect(getBotContext()).toBeUndefined();
  });
});
