/**
 * Discord revalidation gate (fail-closed) on the bot's edit-family +
 * create ops: missing acting user -> 400, Discord failure -> 503,
 * non-manager -> 403, manager -> handler reached. Votes and reads stay
 * trusted (a throwing Discord mock must not block them), and the L1
 * service-token gate still runs first.
 *
 * The member-roles lookup is module-mocked with per-test behavior; the
 * manager-role intersection flows through the fixture prisma's
 * guild_settings row (manager_role_id: [FIXTURE_MANAGER_ROLE_ID]).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

const getGuildMemberRolesMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/discordService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/discordService")>();
  return {
    ...actual,
    getGuildMemberRoles: getGuildMemberRolesMock,
  };
});

import { createApp } from "@/app";
import {
  FIXTURE_GUILD_ID,
  FIXTURE_MANAGER_ROLE_ID,
  FIXTURE_POLLS,
  FIXTURE_USER_ID,
  FIXTURE_VOTES,
  type FixturePoll,
  type FixtureVote,
} from "./fixtures";

let app: Express;
const TOKEN = process.env.BOT_SERVICE_TOKEN!;
const USER = FIXTURE_USER_ID.toString();

const PRISTINE_POLLS: FixturePoll[] = FIXTURE_POLLS.map((poll) => ({
  ...poll,
}));
const PRISTINE_VOTES: FixtureVote[] = FIXTURE_VOTES.map((vote) => ({
  ...vote,
}));

beforeEach(() => {
  getGuildMemberRolesMock.mockReset();
  FIXTURE_POLLS.length = 0;
  FIXTURE_POLLS.push(...PRISTINE_POLLS.map((poll) => ({ ...poll })));
  FIXTURE_VOTES.length = 0;
  FIXTURE_VOTES.push(...PRISTINE_VOTES.map((vote) => ({ ...vote })));
});

beforeAll(async () => {
  app = await createApp();
});

describe("bot write revalidation (fail-closed)", () => {
  it("requires the acting user header: 400 with the locked message, nothing written", async () => {
    const response = await request(app)
      .post("/api/v1/bot/polls/delete")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ pollIds: [3] });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "X-Discord-User-Id header is required for this operation",
    );
    expect(getGuildMemberRolesMock).not.toHaveBeenCalled();
    expect(FIXTURE_POLLS).toHaveLength(PRISTINE_POLLS.length);
  });

  it("fails closed with 503 when Discord cannot be reached", async () => {
    getGuildMemberRolesMock.mockRejectedValue(new Error("ECONNRESET"));

    const response = await request(app)
      .post("/api/v1/bot/polls/update")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send([]);

    expect(response.status).toBe(503);
    expect(response.body.message).toBe(
      "Could not verify permissions (Discord unavailable)",
    );
    expect(FIXTURE_POLLS).toHaveLength(PRISTINE_POLLS.length);
  });

  it("rejects non-managers with 403 even when Discord answers", async () => {
    getGuildMemberRolesMock.mockResolvedValue([777n, 888n]);

    const response = await request(app)
      .post("/api/v1/bot/polls/delete")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ pollIds: [3] });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Missing management permissions");
    expect(FIXTURE_POLLS.some((poll) => poll.id === 3)).toBe(true);
  });

  it("passes managers through to the handler (200 observed)", async () => {
    getGuildMemberRolesMock.mockResolvedValue([
      777n,
      FIXTURE_MANAGER_ROLE_ID,
    ]);

    const response = await request(app)
      .post("/api/v1/bot/polls/update-by-tag")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ tag: 2, question: "renamed by manager" });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Polls updated successfully");
    expect(response.body.polls.map((poll: { id: number }) => poll.id)).toEqual(
      [3, 4],
    );
    expect(getGuildMemberRolesMock).toHaveBeenCalledWith(
      FIXTURE_GUILD_ID,
      FIXTURE_USER_ID,
    );
  });

  it("does not revalidate votes or reads (scope boundary)", async () => {
    getGuildMemberRolesMock.mockRejectedValue(new Error("Discord down"));

    const vote = await request(app)
      .post("/api/v1/bot/polls/1/vote")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ choice: 1 });

    expect(vote.status).toBe(200);
    expect(vote.body).toEqual({ votes: [1, 2], total_votes: 3 });

    const read = await request(app)
      .get("/api/v1/bot/polls/1")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(read.status).toBe(200);
    expect(read.body.id).toBe(1);
    expect(getGuildMemberRolesMock).not.toHaveBeenCalled();
  });

  it("still enforces the service token first (401 without it)", async () => {
    const response = await request(app)
      .post("/api/v1/bot/polls/create")
      .set("X-Discord-User-Id", USER)
      .send([]);

    expect(response.status).toBe(401);
    expect(getGuildMemberRolesMock).not.toHaveBeenCalled();
  });
});
