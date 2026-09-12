/**
 * Tag/guild/discord bot mirrors: thin shims over the shared services
 * with web-twin response shapes. Writes (tag create/update) sit behind
 * the fail-closed Discord revalidation gate (missing user -> 400,
 * Discord down -> 503, non-manager -> 403, manager -> passes); reads
 * mount nothing, so a throwing Discord mock must not block them. The
 * new shared filters (tag end-message booleans, guild manage-channel
 * array-contains) are proven on BOTH the web and bot routes, and the
 * router-chain 404 assertion lives on here now that the smoke suite is
 * gone (zero 501 stubs remain anywhere).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

const getGuildMemberRolesMock = vi.hoisted(() => vi.fn());
const fetchGuildChannelsMock = vi.hoisted(() => vi.fn());
const fetchGuildRolesMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/discordService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/discordService")>();
  return {
    ...actual,
    getGuildMemberRoles: getGuildMemberRolesMock,
    fetchGuildChannels: fetchGuildChannelsMock,
    fetchGuildRoles: fetchGuildRolesMock,
  };
});

// The web write twin sits behind requireManagementPerms; stub the
// session-side Discord checks so a faked session passes (the same
// approach as writeServices.test.ts). Read assertions are unaffected:
// the management flag only widens the polls include of the web tag
// list, never which tags are returned.
vi.mock("@/utils/checkDiscordMembership", () => ({
  checkUserInServer: async () => true,
  checkUserHasManagementPerms: async () => true,
  attachManagementPermsFlag: async () => true,
}));

import { createApp } from "@/app";
import { errorHandler } from "@/middleware/errorHandler";
import { tagRouter } from "@/routes/api/v1/tag";
import {
  FIXTURE_GUILD_ID,
  FIXTURE_GUILD_SETTINGS,
  FIXTURE_MANAGE_CHANNEL_A,
  FIXTURE_MANAGE_CHANNEL_B,
  FIXTURE_MANAGER_ROLE_ID,
  FIXTURE_OTHER_GUILD_ID,
  FIXTURE_TAGS,
  FIXTURE_USER_ID,
  type FixtureGuildSettings,
  type FixtureTag,
} from "./fixtures";

let app: Express;
const TOKEN = process.env.BOT_SERVICE_TOKEN!;
const USER = FIXTURE_USER_ID.toString();
const GUILD = FIXTURE_GUILD_ID.toString();
const OTHER_GUILD = FIXTURE_OTHER_GUILD_ID.toString();
const CHANNEL_A = FIXTURE_MANAGE_CHANNEL_A.toString();
const CHANNEL_B = FIXTURE_MANAGE_CHANNEL_B.toString();

const PRISTINE_TAGS: FixtureTag[] = FIXTURE_TAGS.map((tag) => ({ ...tag }));
const PRISTINE_GUILD_SETTINGS: FixtureGuildSettings[] =
  FIXTURE_GUILD_SETTINGS.map((guild) => ({ ...guild }));

beforeEach(() => {
  getGuildMemberRolesMock.mockReset();
  getGuildMemberRolesMock.mockResolvedValue([FIXTURE_MANAGER_ROLE_ID]);
  fetchGuildChannelsMock.mockReset();
  fetchGuildChannelsMock.mockResolvedValue([]);
  fetchGuildRolesMock.mockReset();
  fetchGuildRolesMock.mockResolvedValue([]);
  FIXTURE_TAGS.length = 0;
  FIXTURE_TAGS.push(...PRISTINE_TAGS.map((tag) => ({ ...tag })));
  FIXTURE_GUILD_SETTINGS.length = 0;
  FIXTURE_GUILD_SETTINGS.push(
    ...PRISTINE_GUILD_SETTINGS.map((guild) => ({ ...guild })),
  );
});

beforeAll(async () => {
  app = await createApp();
});

function assertTagRowShape(tag: any) {
  expect(typeof tag.tag).toBe("number");
  expect(typeof tag.name).toBe("string");
  expect(typeof tag.guild_id).toBe("string");
  expect(typeof tag.channel_id).toBe("string");
  expect(Array.isArray(tag.crosspost_channels)).toBe(true);
  expect(Array.isArray(tag.crosspost_servers)).toBe(true);
  expect(tag.end_message === null || typeof tag.end_message === "string").toBe(
    true,
  );
  expect(typeof tag.end_message_replace).toBe("boolean");
  expect(typeof tag.end_message_ping).toBe("boolean");
  expect(typeof tag.end_message_self_assign).toBe("boolean");
  expect(typeof tag.persistent).toBe("boolean");
}

describe("bot tag mirrors", () => {
  it("lists tags with the web-twin array shape (latest-poll include, newest first)", async () => {
    const response = await request(app)
      .get("/api/v1/bot/tags")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.map((tag: any) => tag.tag)).toEqual([2, 1]);
    response.body.forEach(assertTagRowShape);
    expect(response.body[0].polls).toHaveLength(1);
    expect(response.body[0].polls[0].id).toBe(3);
    expect(response.body[1].polls[0].id).toBe(2);
  });

  it("gets a single tag (raw row, no polls include); unknown id -> 404", async () => {
    const response = await request(app)
      .get("/api/v1/bot/tags/1")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    assertTagRowShape(response.body);
    expect(response.body.tag).toBe(1);
    expect(response.body).not.toHaveProperty("polls");

    const missing = await request(app)
      .get("/api/v1/bot/tags/999")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe("Tag with id 999 not found");
  });

  const createBody = {
    name: "T3 mirrored",
    guild_id: GUILD,
    channel_id: "101",
  };

  it("create: missing acting user -> 400, nothing written", async () => {
    const response = await request(app)
      .post("/api/v1/bot/tags/create")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send(createBody);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "X-Discord-User-Id header is required for this operation",
    );
    expect(getGuildMemberRolesMock).not.toHaveBeenCalled();
    expect(FIXTURE_TAGS).toHaveLength(PRISTINE_TAGS.length);
  });

  it("create: Discord unreachable -> 503, nothing written", async () => {
    getGuildMemberRolesMock.mockRejectedValue(new Error("ECONNRESET"));

    const response = await request(app)
      .post("/api/v1/bot/tags/create")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send(createBody);

    expect(response.status).toBe(503);
    expect(response.body.message).toBe(
      "Could not verify permissions (Discord unavailable)",
    );
    expect(FIXTURE_TAGS).toHaveLength(PRISTINE_TAGS.length);
  });

  it("create: non-manager -> 403, nothing written", async () => {
    getGuildMemberRolesMock.mockResolvedValue([777n, 888n]);

    const response = await request(app)
      .post("/api/v1/bot/tags/create")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send(createBody);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Missing management permissions");
    expect(FIXTURE_TAGS).toHaveLength(PRISTINE_TAGS.length);
  });

  it("create: manager -> 201 with the web-twin raw row", async () => {
    const response = await request(app)
      .post("/api/v1/bot/tags/create")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({
        ...createBody,
        crosspost_channels: ["301"],
        end_message_self_assign: true,
      });

    expect(response.status).toBe(201);
    assertTagRowShape(response.body);
    expect(response.body.tag).toBeGreaterThanOrEqual(10000);
    expect(response.body.tag).toBeLessThanOrEqual(99999);
    expect(response.body.name).toBe("T3 mirrored");
    expect(response.body.guild_id).toBe(GUILD);
    expect(response.body.channel_id).toBe("101");
    expect(response.body.crosspost_channels).toEqual(["301"]);
    expect(response.body.end_message_self_assign).toBe(true);
    expect(response.body.persistent).toBe(true);
    expect(FIXTURE_TAGS).toHaveLength(PRISTINE_TAGS.length + 1);
  });

  it("create: duplicate name within the guild -> 400 (shared service)", async () => {
    const first = await request(app)
      .post("/api/v1/bot/tags/create")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send(createBody);
    expect(first.status).toBe(201);

    const dup = await request(app)
      .post("/api/v1/bot/tags/create")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send(createBody);

    expect(dup.status).toBe(400);
    expect(dup.body.message).toBe(
      `Tag name "${createBody.name}" already exists in this guild`,
    );
    expect(FIXTURE_TAGS).toHaveLength(PRISTINE_TAGS.length + 1);
  });

  it("update: missing acting user -> 400", async () => {
    const response = await request(app)
      .post("/api/v1/bot/tags/update")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ tag: 1, name: "nope" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "X-Discord-User-Id header is required for this operation",
    );
    expect(FIXTURE_TAGS.find((tag) => tag.tag === 1)?.name).toBe(
      "T1 persistent tag",
    );
  });

  it("update: Discord unreachable -> 503", async () => {
    getGuildMemberRolesMock.mockRejectedValue(new Error("Discord down"));

    const response = await request(app)
      .post("/api/v1/bot/tags/update")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ tag: 1, name: "nope" });

    expect(response.status).toBe(503);
    expect(FIXTURE_TAGS.find((tag) => tag.tag === 1)?.name).toBe(
      "T1 persistent tag",
    );
  });

  it("update: non-manager -> 403", async () => {
    getGuildMemberRolesMock.mockResolvedValue([777n]);

    const response = await request(app)
      .post("/api/v1/bot/tags/update")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ tag: 1, name: "nope" });

    expect(response.status).toBe(403);
    expect(FIXTURE_TAGS.find((tag) => tag.tag === 1)?.name).toBe(
      "T1 persistent tag",
    );
  });

  it("update: manager -> 200 with the updated raw row", async () => {
    const response = await request(app)
      .post("/api/v1/bot/tags/update")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({
        tag: 1,
        name: "T1 renamed",
        channel_id: "103",
        end_message_ping: true,
      });

    expect(response.status).toBe(200);
    assertTagRowShape(response.body);
    expect(response.body.tag).toBe(1);
    expect(response.body.name).toBe("T1 renamed");
    expect(response.body.channel_id).toBe("103");
    expect(response.body.end_message_ping).toBe(true);

    const stored = FIXTURE_TAGS.find((tag) => tag.tag === 1);
    expect(stored?.name).toBe("T1 renamed");
    expect(stored?.channel_id).toBe(103n);
    expect(stored?.end_message_ping).toBe(true);
  });

  it("update: unknown tag -> 404", async () => {
    const response = await request(app)
      .post("/api/v1/bot/tags/update")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ tag: 999, name: "missing" });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Tag with id 999 not found");
  });

  it("update: unknown or lifecycle-owned fields -> 400", async () => {
    const bogus = await request(app)
      .post("/api/v1/bot/tags/update")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ tag: 1, bogus: true });
    expect(bogus.status).toBe(400);

    const counter = await request(app)
      .post("/api/v1/bot/tags/update")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ tag: 1, current_num: 5 });
    expect(counter.status).toBe(400);
    expect(FIXTURE_TAGS.find((tag) => tag.tag === 1)?.current_num).toBe(1);
  });
});

describe("web tag update twin (session + management perms)", () => {
  let webApp: Express;

  beforeAll(() => {
    webApp = express();
    webApp.use(express.json());
    webApp.use((req, _res, next) => {
      req.isAuthenticated = (() => true) as unknown as typeof req.isAuthenticated;
      req.user = { id: USER, accessToken: "stub" };
      next();
    });
    webApp.use(tagRouter);
    webApp.use(errorHandler);
  });

  it("update: valid body -> 200 with the updated raw row", async () => {
    const response = await request(webApp)
      .post("/update")
      .send({
        tag: 1,
        name: "T1 web renamed",
        channel_id: "103",
        end_message_ping: true,
      });

    expect(response.status).toBe(200);
    assertTagRowShape(response.body);
    expect(response.body.tag).toBe(1);
    expect(response.body.name).toBe("T1 web renamed");
    expect(response.body.channel_id).toBe("103");
    expect(response.body.end_message_ping).toBe(true);

    const stored = FIXTURE_TAGS.find((t) => t.tag === 1);
    expect(stored?.name).toBe("T1 web renamed");
    expect(stored?.channel_id).toBe(103n);
    expect(stored?.end_message_ping).toBe(true);
  });
});

describe("bot guild mirror", () => {
  it("gets a guild with the web-twin shape; unknown id -> 404", async () => {
    const response = await request(app)
      .get(`/api/v1/bot/guilds/${GUILD}`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.guild_id).toBe(GUILD);
    expect(response.body.default_channel_id).toBe("101");
    expect(response.body.manage_channel_id).toEqual([CHANNEL_A]);
    expect(response.body.manager_role_id).toEqual([
      FIXTURE_MANAGER_ROLE_ID.toString(),
    ]);

    const other = await request(app)
      .get(`/api/v1/bot/guilds/${OTHER_GUILD}`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(other.status).toBe(200);
    expect(other.body.guild_id).toBe(OTHER_GUILD);

    const missing = await request(app)
      .get("/api/v1/bot/guilds/888888888888888888")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe(
      "Guild with id 888888888888888888 not found",
    );
  });
});

describe("bot discord mirrors", () => {
  it("channels: 200 with the web-twin formatted shape", async () => {
    fetchGuildChannelsMock.mockResolvedValue([
      { id: "11", name: "general", position: 0 },
      { id: "12", name: "polls", position: 1 },
    ]);

    const response = await request(app)
      .get(`/api/v1/bot/discord/guilds/${GUILD}/channels`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: "11", name: "general", position: 0 },
      { id: "12", name: "polls", position: 1 },
    ]);
    expect(fetchGuildChannelsMock).toHaveBeenCalledWith(GUILD);
  });

  it("roles: 200 with the web-twin formatted shape", async () => {
    fetchGuildRolesMock.mockResolvedValue([
      { id: "22", name: "Polls", color: 0, position: 1, permissions: "1024" },
    ]);

    const response = await request(app)
      .get(`/api/v1/bot/discord/guilds/${GUILD}/roles`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: "22", name: "Polls", color: 0, position: 1, permissions: "1024" },
    ]);
    expect(fetchGuildRolesMock).toHaveBeenCalledWith(GUILD);
  });

  it("rejects other guilds with 403 like the web twin (no Discord call)", async () => {
    const channels = await request(app)
      .get("/api/v1/bot/discord/guilds/123456789012345678/channels")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(channels.status).toBe(403);
    expect(channels.body.message).toBe("Guild not supported");

    const roles = await request(app)
      .get("/api/v1/bot/discord/guilds/123456789012345678/roles")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(roles.status).toBe(403);

    expect(fetchGuildChannelsMock).not.toHaveBeenCalled();
    expect(fetchGuildRolesMock).not.toHaveBeenCalled();
  });
});

describe("mirrors mount no revalidation on reads", () => {
  it("a failing Discord lookup does not block tag/guild/discord reads", async () => {
    getGuildMemberRolesMock.mockReset();
    getGuildMemberRolesMock.mockRejectedValue(new Error("Discord down"));
    fetchGuildChannelsMock.mockResolvedValue([{ id: "11", name: "general", position: 0 }]);
    fetchGuildRolesMock.mockResolvedValue([]);

    const tagList = await request(app)
      .get("/api/v1/bot/tags")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(tagList.status).toBe(200);

    const tagGet = await request(app)
      .get("/api/v1/bot/tags/1")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(tagGet.status).toBe(200);

    const guildGet = await request(app)
      .get(`/api/v1/bot/guilds/${GUILD}`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(guildGet.status).toBe(200);

    const channels = await request(app)
      .get(`/api/v1/bot/discord/guilds/${GUILD}/channels`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(channels.status).toBe(200);

    const roles = await request(app)
      .get(`/api/v1/bot/discord/guilds/${GUILD}/roles`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(roles.status).toBe(200);

    expect(getGuildMemberRolesMock).not.toHaveBeenCalled();
  });
});

describe("shared filters (web + bot parity)", () => {
  it("end_message_self_assign=true returns only T1 on both trees", async () => {
    const bot = await request(app)
      .get("/api/v1/bot/tags?end_message_self_assign=true")
      .set("Authorization", `Bearer ${TOKEN}`);
    const web = await request(app).get(
      "/api/v1/tags?end_message_self_assign=true",
    );

    expect(bot.status).toBe(200);
    expect(web.status).toBe(200);
    expect(bot.body.map((tag: any) => tag.tag)).toEqual([1]);
    expect(web.body.map((tag: any) => tag.tag)).toEqual([1]);
  });

  it("end_message_replace=false returns only T2 on both trees", async () => {
    const bot = await request(app)
      .get("/api/v1/bot/tags?end_message_replace=false")
      .set("Authorization", `Bearer ${TOKEN}`);
    const web = await request(app).get(
      "/api/v1/tags?end_message_replace=false",
    );

    expect(bot.status).toBe(200);
    expect(web.status).toBe(200);
    expect(bot.body.map((tag: any) => tag.tag)).toEqual([2]);
    expect(web.body.map((tag: any) => tag.tag)).toEqual([2]);
  });

  it("invalid tag filter values -> 400", async () => {
    const bot = await request(app)
      .get("/api/v1/bot/tags?end_message_self_assign=maybe")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(bot.status).toBe(400);
    expect(bot.body.message).toBe("Invalid tag filter parameters");
  });

  it("manage_channel_id array-contains filters the web guild list", async () => {
    const all = await request(app).get("/api/v1/guilds");
    expect(all.status).toBe(200);
    expect(all.body.map((guild: any) => guild.guild_id)).toEqual([
      GUILD,
      OTHER_GUILD,
    ]);

    const a = await request(app).get(
      `/api/v1/guilds?manage_channel_id=${CHANNEL_A}`,
    );
    expect(a.body.map((guild: any) => guild.guild_id)).toEqual([GUILD]);

    const b = await request(app).get(
      `/api/v1/guilds?manage_channel_id=${CHANNEL_B}`,
    );
    expect(b.body.map((guild: any) => guild.guild_id)).toEqual([OTHER_GUILD]);

    const none = await request(app).get(
      "/api/v1/guilds?manage_channel_id=666000000000000001",
    );
    expect(none.status).toBe(200);
    expect(none.body).toEqual([]);
  });
});

describe("service token gate on every mirror route", () => {
  const routes: Array<{ method: "get" | "post"; path: string }> = [
    { method: "get", path: "/api/v1/bot/tags" },
    { method: "get", path: "/api/v1/bot/tags/1" },
    { method: "post", path: "/api/v1/bot/tags/create" },
    { method: "post", path: "/api/v1/bot/tags/update" },
    { method: "get", path: `/api/v1/bot/guilds/${GUILD}` },
    { method: "get", path: `/api/v1/bot/discord/guilds/${GUILD}/channels` },
    { method: "get", path: `/api/v1/bot/discord/guilds/${GUILD}/roles` },
  ];

  it("401 without the token", async () => {
    for (const route of routes) {
      const response = await request(app)[route.method](route.path);
      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("message");
    }
  });
});

describe("api surface (relocated from the deleted smoke suite)", () => {
  it("still 404s unknown paths", async () => {
    const response = await request(app).get("/api/v1/definitely-not-a-route");
    expect(response.status).toBe(404);
  });

  it("bot events is a WS-upgrade-only path: plain HTTP GET -> 404 (handshake covered in websocket.test.ts)", async () => {
    const response = await request(app)
      .get("/api/v1/bot/events")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(response.status).toBe(404);
  });
});
