/**
 * Write-service coverage: the post-publish field matrix (choices length,
 * tag, resolved start time; end_time always editable), the `time` alias
 * conflict rule, createPolls/deletePolls/updatePollsByTag semantics
 * (including the fixture mock's FK cascade), and the web + bot shims
 * for all four write ops (byte-preserved response shapes).
 *
 * The fixture prisma's write delegates mutate FIXTURE_POLLS and
 * FIXTURE_VOTES in place, so every test restores pristine copies first.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

// The web write routes sit behind requireManagementPerms; stub the
// Discord checks so a faked session passes (bot routes never reach
// them).
vi.mock("@/utils/checkDiscordMembership", () => ({
  checkUserInServer: async () => true,
  checkUserHasManagementPerms: async () => true,
  attachManagementPermsFlag: async () => true,
}));

// The bot write shims revalidate the acting user's manager role via
// Discord on every request; stub the member lookup as manager so the
// shims exercise their handlers (the gate itself has its own test
// file). The factory dynamic-imports fixtures for the same hoisting
// reason as tests/setup.ts.
vi.mock("@/services/discordService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/discordService")>();
  const { FIXTURE_MANAGER_ROLE_ID } = await import("./fixtures");
  return {
    ...actual,
    getGuildMemberRoles: async () => [FIXTURE_MANAGER_ROLE_ID],
  };
});

import { createApp } from "@/app";
import { ApiError, BadRequestError, NotFoundError } from "@/errors";
import { errorHandler } from "@/middleware/errorHandler";
import { pollRouter } from "@/routes/api/v1/poll";
import {
  createPolls,
  deletePolls,
  updatePolls,
  updatePollsByTag,
  type PollTagUpdateFields,
} from "@/services/pollWriteService";
import { castVote } from "@/services/voteService";
import type { PollWriteInput } from "@/utils/validatePoll";
import {
  FIXTURE_GUILD_ID,
  FIXTURE_POLLS,
  FIXTURE_USER_ID,
  FIXTURE_VOTES,
  type FixturePoll,
  type FixtureVote,
} from "./fixtures";

const TOKEN = process.env.BOT_SERVICE_TOKEN!;
const USER = FIXTURE_USER_ID.toString();
const GUILD = FIXTURE_GUILD_ID.toString();

const P1_START = "2024-01-15T12:00:00.000Z"; // fixture poll 1's start_time
const NEW_TIME = "2025-08-08T12:00:00.000Z";
const NEW_END = "2031-01-01T00:00:00.000Z";

const PRISTINE_POLLS: FixturePoll[] = FIXTURE_POLLS.map((poll) => ({
  ...poll,
}));
const PRISTINE_VOTES: FixtureVote[] = FIXTURE_VOTES.map((vote) => ({
  ...vote,
}));

beforeEach(() => {
  FIXTURE_POLLS.length = 0;
  FIXTURE_POLLS.push(...PRISTINE_POLLS.map((poll) => ({ ...poll })));
  FIXTURE_VOTES.length = 0;
  FIXTURE_VOTES.push(...PRISTINE_VOTES.map((vote) => ({ ...vote })));
});

function pollById(id: number): FixturePoll {
  const poll = FIXTURE_POLLS.find((poll) => poll.id === id);
  if (poll === undefined) throw new Error(`fixture poll ${id} missing`);
  return poll;
}

/** Full update-route-shaped input (validatePoll requires the base fields;
 * guild_id is lifecycle-restricted and must be omitted on update). */
function updateInput(id: number, overrides: Partial<PollWriteInput> = {}) {
  return {
    id,
    question: `Q${id}`,
    choices: ["choice 0", "choice 1"],
    ...overrides,
  };
}

describe("updatePolls field matrix", () => {
  it("published: choices content editable, length frozen", async () => {
    await updatePolls([
      updateInput(1, { choices: ["new 0", "new 1"] }),
    ]);
    expect(pollById(1).choices).toEqual(["new 0", "new 1"]);

    const lengthChange = updatePolls([
      updateInput(1, { choices: ["a", "b", "c"] }),
    ]);
    await expect(lengthChange).rejects.toBeInstanceOf(BadRequestError);
    await expect(lengthChange).rejects.toThrow(
      "Cannot change the number of choices for a published poll",
    );
    // nothing written on rejection
    expect(pollById(1).choices).toEqual(["new 0", "new 1"]);
  });

  it("published: tag omit keeps it, tag change rejected; unpublished: tag change allowed", async () => {
    await updatePolls([updateInput(1)]);
    expect(pollById(1).tag).toBe(1);

    const publishedChange = updatePolls([updateInput(1, { tag: 2 })]);
    await expect(publishedChange).rejects.toThrow(
      "Cannot change the tag of a published poll",
    );

    await updatePolls([updateInput(3, { tag: 1 })]);
    expect(pollById(3).tag).toBe(1);
  });

  it("published: start_time omit keeps it; change rejected via either key", async () => {
    // omit = keep (the old time-equality check 400'd here; the tightened matrix allows it)
    await updatePolls([updateInput(1)]);
    expect(pollById(1).start_time).toEqual(new Date(P1_START));

    const viaTime = updatePolls([updateInput(1, { time: NEW_TIME })]);
    await expect(viaTime).rejects.toThrow(
      "Cannot change the time of a published poll",
    );

    const viaStartTime = updatePolls([
      updateInput(1, { start_time: NEW_TIME }),
    ]);
    await expect(viaStartTime).rejects.toThrow(
      "Cannot change the time of a published poll",
    );
  });

  it("published: equal start_time (time or start_time key) passes", async () => {
    await updatePolls([updateInput(1, { time: P1_START })]);
    expect(pollById(1).start_time).toEqual(new Date(P1_START));

    await updatePolls([updateInput(1, { start_time: P1_START })]);
    expect(pollById(1).start_time).toEqual(new Date(P1_START));
  });

  it("published: time null counts as a change (400)", async () => {
    const cleared = updatePolls([updateInput(1, { time: null })]);
    await expect(cleared).rejects.toBeInstanceOf(BadRequestError);
    await expect(cleared).rejects.toThrow(
      "Cannot change the time of a published poll",
    );
    expect(pollById(1).start_time).toEqual(new Date(P1_START));
  });

  it("published: start_time null no-ops and keeps existing", async () => {
    // deliberate asymmetry: null via the alias is a change, null via
    // start_time resolves to undefined (keep)
    await updatePolls([updateInput(1, { start_time: null })]);
    expect(pollById(1).start_time).toEqual(new Date(P1_START));
  });

  it("unpublished: start_time change allowed and persisted", async () => {
    await updatePolls([updateInput(3, { start_time: NEW_TIME })]);
    expect(pollById(3).start_time).toEqual(new Date(NEW_TIME));

    await updatePolls([updateInput(3, { time: NEW_TIME })]);
    expect(pollById(3).start_time).toEqual(new Date(NEW_TIME));
  });

  it("end_time freely editable in every state (including clearing)", async () => {
    await updatePolls([updateInput(1, { end_time: NEW_END })]);
    expect(pollById(1).end_time).toEqual(new Date(NEW_END));

    await updatePolls([updateInput(3, { end_time: NEW_END })]);
    expect(pollById(3).end_time).toEqual(new Date(NEW_END));

    // P4 ships with an end_time; shortening a running poll is allowed
    await updatePolls([updateInput(4, { end_time: NEW_TIME })]);
    expect(pollById(4).end_time).toEqual(new Date(NEW_TIME));
  });

  it("unpublished: end_time null clears it (stays null, not epoch-0)", async () => {
    await updatePolls([updateInput(3, { end_time: NEW_END })]);
    expect(pollById(3).end_time).toEqual(new Date(NEW_END));

    const [updated] = await updatePolls([updateInput(3, { end_time: null })]);
    expect(updated.end_time).toBeNull();
    expect(pollById(3).end_time).toBeNull();
  });
});

describe("time alias rule", () => {
  it("update: time and start_time with different instants -> 400", async () => {
    const conflict = updatePolls([
      updateInput(3, { time: NEW_TIME, start_time: P1_START }),
    ]);
    await expect(conflict).rejects.toBeInstanceOf(BadRequestError);
    await expect(conflict).rejects.toThrow(
      "'time' and 'start_time' conflict; provide one",
    );
  });

  it("create: equal time and start_time pass and persist", async () => {
    const [created] = await createPolls([
      {
        question: "alias equal",
        choices: ["a", "b"],
        guild_id: FIXTURE_GUILD_ID,
        tag: 1,
        time: NEW_TIME,
        start_time: NEW_TIME,
      },
    ]);
    expect(created.start_time).toEqual(new Date(NEW_TIME));
    expect(pollById(created.id).start_time).toEqual(new Date(NEW_TIME));
  });

  it("create: time and start_time with different instants -> 400", async () => {
    const conflict = createPolls([
      {
        question: "alias conflict",
        choices: ["a", "b"],
        guild_id: FIXTURE_GUILD_ID,
        tag: 1,
        time: NEW_TIME,
        start_time: P1_START,
      },
    ]);
    await expect(conflict).rejects.toBeInstanceOf(BadRequestError);
    await expect(conflict).rejects.toThrow(
      "'time' and 'start_time' conflict; provide one",
    );
  });
});

describe("createPolls", () => {
  const baseCreate = (overrides: Partial<PollWriteInput> = {}) => ({
    question: "created question",
    choices: ["a", "b"],
    guild_id: FIXTURE_GUILD_ID,
    tag: 1,
    ...overrides,
  });

  it("creates with a random 5-digit id, published false, end_time persisted", async () => {
    const created = await createPolls([
      baseCreate({ time: NEW_TIME, end_time: NEW_END }),
    ]);

    expect(created).toHaveLength(1);
    const model = created[0];
    expect(model.id).toBeGreaterThanOrEqual(10000);
    expect(model.id).toBeLessThanOrEqual(99999);
    expect(model.published).toBe(false);
    expect(model.start_time).toEqual(new Date(NEW_TIME));
    expect(model.end_time).toEqual(new Date(NEW_END));
    expect(model.votes).toEqual([]);

    const row = pollById(model.id);
    expect(row.end_time).toEqual(new Date(NEW_END));
    expect(row.num).toBeNull();
    expect(row.message_id).toBeNull();
  });

  it("fallback is not client-settable: fallback true in the body stores false", async () => {
    const [created] = await createPolls([baseCreate({ fallback: true })]);

    expect(created.fallback).toBe(false);
    expect(pollById(created.id).fallback).toBe(false);
  });

  it("rejects a missing tag", async () => {
    const missing = createPolls([baseCreate({ tag: undefined })]);
    await expect(missing).rejects.toBeInstanceOf(BadRequestError);
    await expect(missing).rejects.toThrow("Poll tag is required");
  });

  it("rejects an unknown tag", async () => {
    const unknown = createPolls([baseCreate({ tag: 999 })]);
    await expect(unknown).rejects.toBeInstanceOf(NotFoundError);
    await expect(unknown).rejects.toThrow("Tag with id 999 not found");
  });

  it("rejects another guild's id", async () => {
    const foreign = createPolls([baseCreate({ guild_id: 999n })]);
    await expect(foreign).rejects.toBeInstanceOf(ApiError);
    await expect(foreign).rejects.toThrow(
      "Cannot create polls for other guilds",
    );
  });

  it("rejects non-array and empty bodies", async () => {
    for (const body of [undefined, [], "nope"]) {
      const rejected = createPolls(body as never);
      await expect(rejected).rejects.toThrow(
        "pollsData must be a non-empty array",
      );
    }
  });
});

describe("deletePolls", () => {
  it("rejects published polls (403)", async () => {
    const published = deletePolls(["1"]);
    await expect(published).rejects.toBeInstanceOf(ApiError);
    await expect(published).rejects.toThrow("Cannot delete published polls");
  });

  it("deletes and cascades votes (mock models the FK)", async () => {
    // Give the unpublished P3 a vote first (castVote has no published gate).
    await castVote(3, FIXTURE_USER_ID, 0);
    expect(
      FIXTURE_VOTES.some((vote) => vote.poll_id === 3),
    ).toBe(true);

    const result = await deletePolls(["3"]);

    expect(result).toEqual({ count: 1 });
    expect(FIXTURE_POLLS.some((poll) => poll.id === 3)).toBe(false);
    expect(FIXTURE_VOTES.some((vote) => vote.poll_id === 3)).toBe(false);
  });

  it("rejects empty or missing arrays", async () => {
    for (const ids of [undefined, []]) {
      const rejected = deletePolls(ids as never);
      await expect(rejected).rejects.toThrow(
        "pollIds must be a non-empty array",
      );
    }
  });
});

describe("updatePollsByTag", () => {
  it("applies the fields to every poll of the tag", async () => {
    const fields: PollTagUpdateFields = {
      show_voting: false,
      end_time: NEW_END,
    };
    const updated = await updatePollsByTag(1, fields);

    // tag 1 = P1, P2, P5
    expect(updated).toHaveLength(3);
    expect(updated.map((poll) => poll.id).sort()).toEqual([1, 2, 5]);
    for (const id of [1, 2, 5]) {
      expect(pollById(id).show_voting).toBe(false);
      expect(pollById(id).end_time).toEqual(new Date(NEW_END));
    }
  });

  it("mixed batch: matrix rejects per-poll and the whole batch is atomic", async () => {
    // tag 2 = P3 (unpublished) + P4 (published): moving start_time is
    // frozen on P4, so nothing may be written.
    const rejected = updatePollsByTag(2, { start_time: NEW_TIME });
    await expect(rejected).rejects.toThrow(
      "Cannot change the time of a published poll",
    );
    expect(pollById(3).start_time).toEqual(
      new Date("2030-06-01T12:00:00.000Z"),
    );
    expect(pollById(4).start_time).toEqual(
      new Date("2024-03-15T12:00:00.000Z"),
    );
  });

  it("unknown tags update nothing and return an empty batch", async () => {
    const updated = await updatePollsByTag(999, { question: "x" });
    expect(updated).toEqual([]);
  });
});

describe("web write shims (POST /api/v1/polls/...)", () => {
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

  it("create: 201 with message + serialized polls", async () => {
    const response = await request(webApp)
      .post("/create")
      .send([
        {
          question: "web created",
          choices: ["a", "b"],
          guild_id: GUILD,
          tag: 1,
          time: NEW_TIME,
          end_time: NEW_END,
        },
      ]);
    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Polls created successfully");
    const poll = response.body.polls[0];
    expect(poll.id).toBeGreaterThanOrEqual(10000);
    expect(poll.published).toBe(false);
    expect(poll.start_time).toBe(NEW_TIME);
    expect(poll.end_time).toBe(NEW_END);
    expect(poll.votes).toEqual([0, 0]);
    expect(poll.total_votes).toBe(0);
  });

  it("create: rejects empty arrays", async () => {
    const response = await request(webApp).post("/create").send([]);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("pollsData must be a non-empty array");
  });

  it("update: 200 with message + serialized polls", async () => {
    const response = await request(webApp)
      .post("/update")
      .send([
        updateInput(3, {
          question: "P3 edited",
          choices: ["P3 choice 0", "P3 choice 1"],
          tag: 2,
        }),
      ]);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Polls updated successfully");
    expect(response.body.polls[0].id).toBe(3);
    expect(response.body.polls[0].question).toBe("P3 edited");
    expect(response.body.polls[0].published).toBe(false);
  });

  it("update: matrix rejections surface as 400", async () => {
    const response = await request(webApp)
      .post("/update")
      .send([updateInput(1, { choices: ["a", "b", "c"] })]);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Cannot change the number of choices for a published poll",
    );
  });

  it("delete: 200 with the byte-preserved body", async () => {
    const response = await request(webApp)
      .post("/delete")
      .send({ pollIds: ["3"] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Polls deleted successfully",
      deletedCount: 1,
    });
    expect(FIXTURE_POLLS.some((poll) => poll.id === 3)).toBe(false);
  });
});

describe("bot write shims (POST /api/v1/bot/polls/...)", () => {
  let botApp: Express;

  beforeAll(async () => {
    botApp = await createApp();
  });

  it("create: 201 with the same shape as web", async () => {
    const response = await request(botApp)
      .post("/api/v1/bot/polls/create")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send([
        {
          question: "bot created",
          choices: ["a", "b"],
          guild_id: GUILD,
          tag: 1,
          start_time: NEW_TIME,
        },
      ]);
    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Polls created successfully");
    const poll = response.body.polls[0];
    expect(poll.id).toBeGreaterThanOrEqual(10000);
    expect(poll.published).toBe(false);
    expect(poll.start_time).toBe(NEW_TIME);
  });

  it("create: rejects non-array bodies", async () => {
    const response = await request(botApp)
      .post("/api/v1/bot/polls/create")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ nope: true });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("pollsData must be a non-empty array");
  });

  it("update: 200 with message + serialized polls", async () => {
    const response = await request(botApp)
      .post("/api/v1/bot/polls/update")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send([
        updateInput(3, {
          question: "bot edited",
          choices: ["P3 choice 0", "P3 choice 1"],
          tag: 2,
        }),
      ]);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Polls updated successfully");
    expect(response.body.polls[0].question).toBe("bot edited");
  });

  it("update: matrix rejections surface as 400", async () => {
    const response = await request(botApp)
      .post("/api/v1/bot/polls/update")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send([updateInput(1, { tag: 2 })]);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Cannot change the tag of a published poll",
    );
  });

  it("delete: 200 with deletedCount", async () => {
    const response = await request(botApp)
      .post("/api/v1/bot/polls/delete")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ pollIds: [3] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Polls deleted successfully",
      deletedCount: 1,
    });
  });

  it("delete: published polls rejected 403", async () => {
    const response = await request(botApp)
      .post("/api/v1/bot/polls/delete")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ pollIds: [1] });
    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Cannot delete published polls");
  });

  it("update-by-tag: 200 updating every poll of the tag", async () => {
    const response = await request(botApp)
      .post("/api/v1/bot/polls/update-by-tag")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ tag: 2, question: "renamed" });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Polls updated successfully");
    expect(response.body.polls.map((poll: { id: number }) => poll.id)).toEqual(
      [3, 4],
    );
    expect(response.body.polls.every(
      (poll: { question: string }) => poll.question === "renamed",
    )).toBe(true);
  });

  it("update-by-tag: unknown fields rejected 400 listing them", async () => {
    const response = await request(botApp)
      .post("/api/v1/bot/polls/update-by-tag")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ tag: 2, question: "renamed", bogus: true });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Unknown fields: bogus");
    expect(pollById(3).num).toBeNull();
  });
});
