/**
 * castVote coverage: service semantics (upsert, null-deletes, bounds,
 * tallies, id scheme), the byte-identical web shim messages, and the
 * counts-only bot contract.
 *
 * The fixture prisma's write delegates mutate FIXTURE_VOTES in place, so
 * every test restores a pristine copy first (poll delegates join votes
 * from the same array — in-place restore keeps all views consistent).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

// The web vote route sits behind requireAuth; stub the Discord
// membership check so a faked session is enough (bot routes never
// reach it).
vi.mock("@/utils/checkDiscordMembership", () => ({
  checkUserInServer: async () => true,
  checkUserHasManagementPerms: async () => false,
  attachManagementPermsFlag: async () => false,
}));

import { createApp } from "@/app";
import { BadRequestError, NotFoundError } from "@/errors";
import { errorHandler } from "@/middleware/errorHandler";
import { pollRouter } from "@/routes/api/v1/poll";
import { castVote } from "@/services/voteService";
import {
  FIXTURE_USER_ID,
  FIXTURE_VOTES,
  type FixtureVote,
} from "./fixtures";

const TOKEN = process.env.BOT_SERVICE_TOKEN!;
const USER = FIXTURE_USER_ID.toString();

const PRISTINE_VOTES: FixtureVote[] = FIXTURE_VOTES.map((vote) => ({ ...vote }));

beforeEach(() => {
  FIXTURE_VOTES.length = 0;
  FIXTURE_VOTES.push(...PRISTINE_VOTES.map((vote) => ({ ...vote })));
});

function votesFor(user: bigint, pollId: number): FixtureVote[] {
  return FIXTURE_VOTES.filter(
    (vote) => vote.user_id === user && vote.poll_id === pollId,
  );
}

describe("castVote service", () => {
  it("creates a vote with the userId*100000+pollId id scheme and correct tallies", async () => {
    // P4: THIRD user already voted choice 0; FIXTURE_USER has no vote there.
    const result = await castVote(4, FIXTURE_USER_ID, 1);

    expect(result.had_vote).toBe(false);
    expect(result.deleted).toBe(false);
    expect(result.votes).toEqual([1, 1]);
    expect(result.total_votes).toBe(2);

    const rows = votesFor(FIXTURE_USER_ID, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(FIXTURE_USER_ID * 100000n + 4n);
    expect(rows[0].choice).toBe(1);
  });

  it("updates an existing vote in place (id preserved)", async () => {
    const result = await castVote(1, FIXTURE_USER_ID, 1);

    expect(result.had_vote).toBe(true);
    expect(result.deleted).toBe(false);
    // P1 was [USER:0, OTHER:0, THIRD:1]; USER moves to choice 1.
    expect(result.votes).toEqual([1, 2]);
    expect(result.total_votes).toBe(3);

    const rows = votesFor(FIXTURE_USER_ID, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1n);
    expect(rows[0].choice).toBe(1);
  });

  it("deletes an existing vote on null choice", async () => {
    const result = await castVote(1, FIXTURE_USER_ID, null);

    expect(result.had_vote).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.votes).toEqual([1, 1]);
    expect(result.total_votes).toBe(2);
    expect(votesFor(FIXTURE_USER_ID, 1)).toHaveLength(0);
  });

  it("reports a no-op delete when no vote exists", async () => {
    // FIXTURE_USER never voted on P4.
    const result = await castVote(4, FIXTURE_USER_ID, null);

    expect(result.had_vote).toBe(false);
    expect(result.deleted).toBe(false);
    expect(result.votes).toEqual([1, 0]);
    expect(result.total_votes).toBe(1);
    expect(FIXTURE_VOTES).toHaveLength(PRISTINE_VOTES.length);
  });

  it("rejects out-of-bounds choices (>= length and negative)", async () => {
    const tooBig = castVote(1, FIXTURE_USER_ID, 2);
    await expect(tooBig).rejects.toBeInstanceOf(BadRequestError);
    await expect(tooBig).rejects.toThrow("2 is not a valid choice");

    const negative = castVote(1, FIXTURE_USER_ID, -1);
    await expect(negative).rejects.toBeInstanceOf(BadRequestError);
    await expect(negative).rejects.toThrow("-1 is not a valid choice");

    expect(FIXTURE_VOTES).toHaveLength(PRISTINE_VOTES.length);
  });

  it("maps unknown polls to NotFoundError", async () => {
    const unknown = castVote(999, FIXTURE_USER_ID, 0);
    await expect(unknown).rejects.toBeInstanceOf(NotFoundError);
    await expect(unknown).rejects.toThrow("Poll not found");
  });
});

describe("web vote shim (POST /api/v1/polls/:pollId/vote)", () => {
  let webApp: Express;

  beforeAll(() => {
    webApp = express();
    webApp.use(express.json());
    webApp.use((req, _res, next) => {
      req.isAuthenticated = (() => true) as unknown as typeof req.isAuthenticated;
      req.user = { id: USER, accessToken: "stub" };
      next();
    });
    webApp.use(pollRouter);
    webApp.use(errorHandler);
  });

  it("responds 'Vote cast successfully' and updates on idempotent re-vote", async () => {
    const first = await request(webApp)
      .post("/1/vote")
      .send({ userId: USER, choice: 1 });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ message: "Vote cast successfully" });

    const second = await request(webApp)
      .post("/1/vote")
      .send({ userId: USER, choice: 0 });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ message: "Vote cast successfully" });

    const rows = votesFor(FIXTURE_USER_ID, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].choice).toBe(0);
  });

  it("responds 'Vote deleted successfully' then 'No vote to delete'", async () => {
    const deleted = await request(webApp)
      .post("/1/vote")
      .send({ userId: USER, choice: null });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ message: "Vote deleted successfully" });
    expect(votesFor(FIXTURE_USER_ID, 1)).toHaveLength(0);

    const noOp = await request(webApp)
      .post("/1/vote")
      .send({ userId: USER, choice: null });
    expect(noOp.status).toBe(200);
    expect(noOp.body).toEqual({ message: "No vote to delete" });
  });
});

describe("bot vote shim (POST /api/v1/bot/polls/:pollId/vote)", () => {
  let app: Express;

  beforeAll(async () => {
    app = await createApp();
  });

  it("responds counts-only: exact key set, real tallies", async () => {
    // FIXTURE_USER's existing P1 vote (choice 0) moves to choice 1:
    // fixture reality is then [OTHER:0, THIRD:1, USER:1] = [1, 2] / 3.
    const response = await request(app)
      .post("/api/v1/bot/polls/1/vote")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ choice: 1 });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual([
      "total_votes",
      "votes",
    ]);
    expect(response.body).toEqual({ votes: [1, 2], total_votes: 3 });
  });

  it("creates a first vote through the bot shim", async () => {
    // FIXTURE_USER has no P4 vote; choice 1 makes [1, 1] / 2.
    const response = await request(app)
      .post("/api/v1/bot/polls/4/vote")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ choice: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ votes: [1, 1], total_votes: 2 });
  });

  it("requires the user header: 400 with the locked message", async () => {
    const response = await request(app)
      .post("/api/v1/bot/polls/1/vote")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ choice: 0 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "X-Discord-User-Id header is required for voting",
    );
  });

  it("still enforces the service token (401 without it)", async () => {
    const response = await request(app)
      .post("/api/v1/bot/polls/1/vote")
      .set("X-Discord-User-Id", USER)
      .send({ choice: 0 });

    expect(response.status).toBe(401);
  });
});
