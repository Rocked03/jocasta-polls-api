import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "@/app";
import { FIXTURE_GUILD_ID, FIXTURE_USER_ID } from "./fixtures";

let app: Express;
const TOKEN = process.env.BOT_SERVICE_TOKEN!;
const GUILD = FIXTURE_GUILD_ID.toString();

beforeAll(async () => {
  app = await createApp();
});

function assertContractShape(poll: any) {
  for (const field of [
    "start_time",
    "end_time",
    "time",
    "votes",
    "total_votes",
    "active",
  ]) {
    expect(poll).toHaveProperty(field);
  }
  expect(Array.isArray(poll.votes)).toBe(true);
  expect(typeof poll.total_votes).toBe("number");
  expect(typeof poll.active).toBe("boolean");
  expect(poll.time).toBe(poll.start_time);
  expect(poll).not.toHaveProperty("tagRelation");
}

describe("bot poll reads", () => {
  it("lists polls with the full contract shape and visible tallies", async () => {
    const response = await request(app)
      .get(`/api/v1/bot/polls?guildId=${GUILD}`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((poll: any) => poll.id)).toEqual([4, 2, 1, 5]);
    response.body.data.forEach(assertContractShape);
    // Computed active: P4/P2/P1 running, P5 ended.
    expect(
      response.body.data.map((poll: any) => [poll.id, poll.active]),
    ).toEqual([
      [4, true],
      [2, true],
      [1, true],
      [5, false],
    ]);
    expect(response.body.meta).toEqual({
      total: 4,
      page: 1,
      limit: 10,
      totalPages: 1,
      nextPage: null,
      prevPage: null,
    });
  });

  it("rejects unauthenticated requests with 401", async () => {
    const response = await request(app).get(`/api/v1/bot/polls?guildId=${GUILD}`);
    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message");
  });

  it("allows published=false directly (bot privilege): only the unpublished P3", async () => {
    const response = await request(app)
      .get(`/api/v1/bot/polls?guildId=${GUILD}&published=false`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((poll: any) => poll.id)).toEqual([3]);
  });

  it("returns a single poll contract shape; unknown id gives 404", async () => {
    const response = await request(app)
      .get("/api/v1/bot/polls/1")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    assertContractShape(response.body);
    expect(response.body.id).toBe(1);
    expect(response.body.votes).toEqual([2, 1]);
    expect(response.body.total_votes).toBe(3);
    expect(response.body.start_time).toBe("2024-01-15T12:00:00.000Z");
    expect(response.body.end_time).toBeNull();
    expect(response.body.guild_id).toBe(GUILD);
    expect(response.body.active).toBe(true);

    const missing = await request(app)
      .get("/api/v1/bot/polls/999")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(missing.status).toBe(404);
  });

  it("returns aggregated vote counts for a hidden-voting poll (override)", async () => {
    const response = await request(app)
      .get("/api/v1/bot/polls/2/votes")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { choice: 0, votes: 1 },
      { choice: 1, votes: 1 },
    ]);
  });

  it("maps votes lookups for unknown polls to 404", async () => {
    const response = await request(app)
      .get("/api/v1/bot/polls/999/votes")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("message");
  });

  it("returns all of a user's votes as an array", async () => {
    const response = await request(app)
      .get(`/api/v1/bot/polls/votes/${FIXTURE_USER_ID}`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((vote: any) => vote.poll_id)).toEqual([1, 2]);
    response.body.forEach((vote: any) => {
      expect(vote.user_id).toBe(FIXTURE_USER_ID.toString());
    });
  });

  it("sync returns every poll including unpublished with offset pagination", async () => {
    const response = await request(app)
      .get(`/api/v1/bot/polls/sync?guildId=${GUILD}`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((poll: any) => poll.id)).toEqual([3, 4, 2, 1, 5]);
    response.body.data.forEach(assertContractShape);
    // Computed active: only the unpublished P3 and the ended P5 are inactive.
    expect(
      response.body.data.map((poll: any) => [poll.id, poll.active]),
    ).toEqual([
      [3, false],
      [4, true],
      [2, true],
      [1, true],
      [5, false],
    ]);
    expect(response.body.meta.total).toBe(5);

    const secondPage = await request(app)
      .get(`/api/v1/bot/polls/sync?guildId=${GUILD}&page=2&limit=2`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data.map((poll: any) => poll.id)).toEqual([2, 1]);
    expect(secondPage.body.meta).toEqual({
      total: 5,
      page: 2,
      limit: 2,
      totalPages: 3,
      nextPage: 3,
      prevPage: 1,
    });
  });

  it("start-timer composition (published=false&has_start=true) returns the scheduled poll only", async () => {
    const response = await request(app)
      .get(`/api/v1/bot/polls?guildId=${GUILD}&published=false&has_start=true`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((poll: any) => poll.id)).toEqual([3]);
  });

  it("end-timer composition (active=true&has_end=true) returns the end-scheduled poll only", async () => {
    const response = await request(app)
      .get(`/api/v1/bot/polls?guildId=${GUILD}&active=true&has_end=true`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((poll: any) => poll.id)).toEqual([4]);
  });

  it("filters polls without an end time (null-literal matcher)", async () => {
    const response = await request(app)
      .get(`/api/v1/bot/polls?guildId=${GUILD}&has_end=false`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((poll: any) => poll.id)).toEqual([2, 1]);
  });

  it("active=true returns only the running set (no ended P5)", async () => {
    const response = await request(app)
      .get(`/api/v1/bot/polls?guildId=${GUILD}&active=true`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((poll: any) => poll.id)).toEqual([4, 2, 1]);
  });

  it("live=true includes the persistent ended P5 beyond the running set", async () => {
    const liveResponse = await request(app)
      .get(`/api/v1/bot/polls?guildId=${GUILD}&live=true`)
      .set("Authorization", `Bearer ${TOKEN}`);
    const activeResponse = await request(app)
      .get(`/api/v1/bot/polls?guildId=${GUILD}&active=true`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(liveResponse.status).toBe(200);
    expect(activeResponse.status).toBe(200);
    const liveIds = liveResponse.body.data.map((poll: any) => poll.id);
    const activeIds = activeResponse.body.data.map((poll: any) => poll.id);
    expect(liveIds).toEqual([4, 2, 1, 5]);

    // The difference between live and active is exactly the evergreen P5,
    // proven from the responses: live contains all of active plus P5 only.
    expect(liveIds).toEqual(expect.arrayContaining(activeIds));
    expect(liveIds.filter((id: number) => !activeIds.includes(id))).toEqual([5]);
  });

  it("search composes with live=true: only the intersection (route-level OR + conjunct)", async () => {
    const response = await request(app)
      .get(`/api/v1/bot/polls?guildId=${GUILD}&search=P1&live=true`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    // search=P1 matches only P1 among published polls; live=true alone
    // yields [4, 2, 1, 5], so the composed result is exactly [1].
    expect(response.body.data.map((poll: any) => poll.id)).toEqual([1]);
    expect(response.body.meta.total).toBe(1);
  });
});
