import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "@/app";
import { BadRequestError } from "@/errors";
import {
  type PollFilterParams,
  parsePollFilterParams,
} from "@/models/paramModels";
import { buildPollAuxFilters } from "@/services/pollFilters";
import { FIXTURE_GUILD_ID } from "./fixtures";

const GUILD = FIXTURE_GUILD_ID.toString();

// Injected clock for the derived-active filters: keeps the builder truth
// tables deterministic (route-level determinism comes from far-dated
// fixture polls instead).
const NOW = new Date("2026-06-15T12:00:00.000Z");

const DERIVED_ACTIVE = {
  published: true,
  start_time: { lte: NOW },
  OR: [{ end_time: null }, { end_time: { gt: NOW } }],
};

let app: Express;

beforeAll(async () => {
  app = await createApp();
});

describe("buildPollAuxFilters", () => {
  it("returns an empty conjunct array for empty params", () => {
    expect(buildPollAuxFilters({}, NOW)).toEqual([]);
  });

  it("maps ids to a single id IN conjunct", () => {
    expect(buildPollAuxFilters({ ids: [12345, 67890] }, NOW)).toEqual([
      { id: { in: [12345, 67890] } },
    ]);
  });

  it("adds no conjunct for an empty ids array", () => {
    expect(buildPollAuxFilters({ ids: [] }, NOW)).toEqual([]);
  });

  it("maps num to a single equality conjunct", () => {
    expect(buildPollAuxFilters({ num: 7 }, NOW)).toEqual([{ num: 7 }]);
  });

  it("active=true derives published+started+not-ended against the injected now", () => {
    expect(buildPollAuxFilters({ active: true }, NOW)).toEqual([
      DERIVED_ACTIVE,
    ]);
  });

  it("active=false is the exact NOT complement of the derived-active object", () => {
    expect(buildPollAuxFilters({ active: false }, NOW)).toEqual([
      { NOT: DERIVED_ACTIVE },
    ]);
  });

  it("live=true ORs the derived-active object with the persistent-tag arm", () => {
    expect(buildPollAuxFilters({ live: true }, NOW)).toEqual([
      { OR: [DERIVED_ACTIVE, { tagRelation: { persistent: true } }] },
    ]);
  });

  it("live=false adds no conjunct", () => {
    expect(buildPollAuxFilters({ live: false }, NOW)).toEqual([]);
  });

  it("has_start=true maps to a start_time IS NOT NULL conjunct", () => {
    expect(buildPollAuxFilters({ has_start: true }, NOW)).toEqual([
      { start_time: { not: null } },
    ]);
  });

  it("has_start=false maps to a start_time IS NULL conjunct (literal null)", () => {
    expect(buildPollAuxFilters({ has_start: false }, NOW)).toEqual([
      { start_time: null },
    ]);
  });

  it("has_end=true maps to an end_time IS NOT NULL conjunct", () => {
    expect(buildPollAuxFilters({ has_end: true }, NOW)).toEqual([
      { end_time: { not: null } },
    ]);
  });

  it("has_end=false maps to an end_time IS NULL conjunct (literal null)", () => {
    expect(buildPollAuxFilters({ has_end: false }, NOW)).toEqual([
      { end_time: null },
    ]);
  });

  it("combines has_start=false with has_end=true as two conjuncts", () => {
    expect(
      buildPollAuxFilters({ has_start: false, has_end: true }, NOW),
    ).toEqual([{ start_time: null }, { end_time: { not: null } }]);
  });

  it("combines ids, num, and the boolean predicates into one conjunct per filter", () => {
    expect(
      buildPollAuxFilters(
        {
          ids: [1, 2, 3],
          num: 42,
          active: true,
          has_end: true,
          live: true,
        },
        NOW,
      ),
    ).toEqual([
      { id: { in: [1, 2, 3] } },
      { num: 42 },
      DERIVED_ACTIVE,
      { end_time: { not: null } },
      { OR: [DERIVED_ACTIVE, { tagRelation: { persistent: true } }] },
    ]);
  });

  it("open-ended polls stay in scope: the derived object's OR keeps the end_time null arm", () => {
    const [conjunct] = buildPollAuxFilters({ active: true }, NOW);
    expect(conjunct.OR).toContainEqual({ end_time: null });
    const [liveConjunct] = buildPollAuxFilters({ live: true }, NOW);
    expect(liveConjunct.OR?.[0]?.OR).toContainEqual({ end_time: null });
  });

  it("does not mutate the params object", () => {
    const params = { ids: [9], num: 1, active: false, has_end: true };
    buildPollAuxFilters(params, NOW);
    expect(params).toEqual({ ids: [9], num: 1, active: false, has_end: true });
  });
});

describe("parsePollFilterParams order=random conflicts", () => {
  it.each([
    [{ num: 7 }],
    [{ active: "true" }],
    [{ active: "false" }],
    [{ has_start: "true" }],
    [{ has_start: "false" }],
    [{ has_end: "true" }],
    [{ has_end: "false" }],
    [{ live: "true" }],
    [{ live: "false" }],
  ])("rejects order=random with %o", async (extra) => {
    const promise = parsePollFilterParams({
      order: "random",
      ...extra,
    } as unknown as PollFilterParams);

    await expect(promise).rejects.toBeInstanceOf(BadRequestError);
    await expect(promise).rejects.toThrow(
      "'num', 'active', 'live', 'has_start', and 'has_end' are not supported with order=random"
    );
  });

  it("accepts order=random with ids alone", async () => {
    const parsed = await parsePollFilterParams({
      order: "random",
      ids: "12345,67890",
    } as unknown as PollFilterParams);

    expect(parsed.order).toBe("random");
    expect(parsed.ids).toEqual([12345, 67890]);
    expect(parsed.num).toBeUndefined();
    expect(parsed.active).toBeUndefined();
    expect(parsed.has_start).toBeUndefined();
    expect(parsed.has_end).toBeUndefined();
    expect(parsed.live).toBeUndefined();
  });
});

describe("parsePollFilterParams ids/userId conflicts", () => {
  it("rejects ids combined with userId", async () => {
    const promise = parsePollFilterParams({
      ids: "12345,67890",
      userId: "111111111111111111",
    } as unknown as PollFilterParams);

    await expect(promise).rejects.toBeInstanceOf(BadRequestError);
    await expect(promise).rejects.toThrow(
      "'ids' cannot be combined with 'userId'"
    );
  });

  it("parses ids alone", async () => {
    const parsed = await parsePollFilterParams({
      ids: "12345,67890",
    } as unknown as PollFilterParams);

    expect(parsed.ids).toEqual([12345, 67890]);
    expect(parsed.userId).toBeUndefined();
  });

  it("parses userId alone", async () => {
    const parsed = await parsePollFilterParams({
      userId: "111111111111111111",
    } as unknown as PollFilterParams);

    expect(parsed.userId).toBe(111111111111111111n);
    expect(parsed.ids).toBeUndefined();
  });
});

describe("GET /api/v1/polls unpublished gate", () => {
  it("returns 403 for published=false without an OAuth session", async () => {
    const response = await request(app).get(
      `/api/v1/polls?guildId=${GUILD}&published=false`,
    );
    expect(response.status).toBe(403);
  });

  it("unauthenticated active=false derives only published inactive polls (forced published:true composes via AND)", async () => {
    const response = await request(app).get(
      `/api/v1/polls?guildId=${GUILD}&active=false`,
    );

    expect(response.status).toBe(200);
    // P5 (published, ended) is the only published inactive poll; the
    // unpublished P3 also fails the derived-active conjunct but the
    // route's forced published:true must exclude it.
    expect(response.body.data.map((poll: any) => poll.id)).toEqual([5]);
    expect(
      response.body.data.every((poll: any) => poll.published === true),
    ).toBe(true);
  });
});
