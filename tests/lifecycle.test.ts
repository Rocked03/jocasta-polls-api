/**
 * Lifecycle coverage: publish/end/crosspost services (idempotency is
 * the design heart — no double increment, no end_time overwrite), the
 * never-editable tightening on /update (num/message_id/crosspost_
 * message_ids/fallback/guild_id fail loudly naming the designated
 * endpoint), and the bot shims (system ops: service token only, NO
 * revalidation — a throwing Discord mock must not block them).
 *
 * The fixture prisma's write delegates mutate FIXTURE_POLLS,
 * FIXTURE_VOTES, and (via tag.update's counter bump) FIXTURE_TAGS in
 * place, so every test restores pristine copies first.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

// Lifecycle shims must not revalidate (system ops): default the member
// lookup to manager so the edit-family routes used by the tightening
// cases pass their gate, and flip it to a rejection for the
// no-revalidation test.
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
import { BadRequestError, NotFoundError } from "@/errors";
import {
  crosspostPoll,
  endPoll,
  publishPoll,
} from "@/services/pollLifecycleService";
import { createPolls, updatePolls } from "@/services/pollWriteService";
import type { PollWriteInput } from "@/utils/validatePoll";
import {
  FIXTURE_GUILD_ID,
  FIXTURE_MANAGER_ROLE_ID,
  FIXTURE_POLLS,
  FIXTURE_TAGS,
  FIXTURE_USER_ID,
  FIXTURE_VOTES,
  type FixturePoll,
  type FixtureTag,
  type FixtureVote,
} from "./fixtures";

const TOKEN = process.env.BOT_SERVICE_TOKEN!;
const USER = FIXTURE_USER_ID.toString();

const P3_START = new Date("2030-06-01T12:00:00.000Z"); // fixture poll 3's start

const MESSAGE_ID = 900000000000000001n;
const CROSSPOST_IDS = [910000000000000001n, 910000000000000002n];

const PRISTINE_POLLS: FixturePoll[] = FIXTURE_POLLS.map((poll) => ({
  ...poll,
}));
const PRISTINE_VOTES: FixtureVote[] = FIXTURE_VOTES.map((vote) => ({
  ...vote,
}));
const PRISTINE_TAGS: FixtureTag[] = FIXTURE_TAGS.map((tag) => ({ ...tag }));

beforeEach(() => {
  // Default the member lookup to manager so the edit-family routes the
  // tightening cases hit pass their revalidation gate.
  getGuildMemberRolesMock.mockReset();
  getGuildMemberRolesMock.mockResolvedValue([FIXTURE_MANAGER_ROLE_ID]);
  FIXTURE_POLLS.length = 0;
  FIXTURE_POLLS.push(...PRISTINE_POLLS.map((poll) => ({ ...poll })));
  FIXTURE_VOTES.length = 0;
  FIXTURE_VOTES.push(...PRISTINE_VOTES.map((vote) => ({ ...vote })));
  FIXTURE_TAGS.length = 0;
  FIXTURE_TAGS.push(...PRISTINE_TAGS.map((tag) => ({ ...tag })));
});

function tagById(id: number): FixtureTag {
  const tag = FIXTURE_TAGS.find((tag) => tag.tag === id);
  if (tag === undefined) throw new Error(`fixture tag ${id} missing`);
  return tag;
}

function pollById(id: number): FixturePoll {
  const poll = FIXTURE_POLLS.find((poll) => poll.id === id);
  if (poll === undefined) throw new Error(`fixture poll ${id} missing`);
  return poll;
}

describe("publishPoll", () => {
  it("increments the tag counter atomically and stamps all publish fields", async () => {
    const poll = await publishPoll(3, {
      message_id: MESSAGE_ID,
      crosspost_message_ids: CROSSPOST_IDS,
    });

    expect(poll.published).toBe(true);
    expect(poll.num).toBe(2); // tag 2's current_num: 1 -> 2
    expect(poll.message_id).toBe(MESSAGE_ID);
    expect(poll.crosspost_message_ids).toEqual(CROSSPOST_IDS);
    expect(poll.start_time).toEqual(P3_START); // existing start preserved
    expect(tagById(2).current_num).toBe(2);
    expect(pollById(3).published).toBe(true);
  });

  it("stamps start_time when the poll has none", async () => {
    const [created] = await createPolls([
      {
        question: "no start yet",
        choices: ["a", "b"],
        guild_id: FIXTURE_GUILD_ID,
        tag: 1,
      },
    ]);
    expect(created.start_time).toBeNull();

    const published = await publishPoll(created.id, {
      message_id: MESSAGE_ID,
      crosspost_message_ids: [],
    });
    expect(published.start_time).not.toBeNull();
  });

  it("returns the full serialized contract (derived active included)", async () => {
    const poll = await publishPoll(3, {
      message_id: MESSAGE_ID,
      crosspost_message_ids: CROSSPOST_IDS,
    });

    expect(poll).toEqual({
      id: 3,
      question: "P3 unpublished scheduled",
      published: true,
      // start is the far-future fixture constant -> derived inactive
      active: false,
      guild_id: FIXTURE_GUILD_ID,
      choices: ["P3 choice 0", "P3 choice 1"],
      votes: [0, 0],
      total_votes: 0,
      time: P3_START, // compatibility alias
      start_time: P3_START,
      end_time: null,
      num: 2,
      message_id: MESSAGE_ID,
      crosspost_message_ids: CROSSPOST_IDS,
      tag: 2,
      image: null,
      description: null,
      thread_question: null,
      show_question: true,
      show_options: true,
      show_voting: true,
      fallback: false,
    });
  });

  it("is idempotent: a second publish does not increment or overwrite", async () => {
    const first = await publishPoll(3, {
      message_id: MESSAGE_ID,
      crosspost_message_ids: CROSSPOST_IDS,
    });

    const second = await publishPoll(3, {
      message_id: 999n, // different message must NOT overwrite
      crosspost_message_ids: [888n],
    });

    expect(second.num).toBe(first.num); // no double increment
    expect(second.message_id).toBe(MESSAGE_ID);
    expect(second.crosspost_message_ids).toEqual(CROSSPOST_IDS);
    expect(tagById(2).current_num).toBe(2); // counter bumped exactly once
  });

  it("rejects unknown polls with 404", async () => {
    const missing = publishPoll(999, {
      message_id: MESSAGE_ID,
      crosspost_message_ids: [],
    });
    await expect(missing).rejects.toBeInstanceOf(NotFoundError);
    await expect(missing).rejects.toThrow("Poll with id 999 not found");
  });
});

describe("endPoll", () => {
  it("sets end_time and returns the serialized poll", async () => {
    const ended = await endPoll(1);

    expect(ended.end_time).not.toBeNull();
    expect(ended.id).toBe(1);
    expect(ended.published).toBe(true);
    // ended now -> derived inactive even though it was active
    expect(ended.active).toBe(false);
    expect(pollById(1).end_time).not.toBeNull();
  });

  it("is idempotent: a second end keeps the first end_time", async () => {
    const first = await endPoll(1);
    const second = await endPoll(1);

    expect(second.end_time).toEqual(first.end_time);
  });

  it("is idempotent for a poll that already shipped an end_time", async () => {
    // P5 has a fixed past end_time; ending it again must not move it
    const ended = await endPoll(5);
    expect(ended.end_time).toEqual(new Date("2024-05-01T12:00:00.000Z"));
  });

  it("rejects unknown polls with 404", async () => {
    const missing = endPoll(999);
    await expect(missing).rejects.toThrow("Poll with id 999 not found");
  });
});

describe("crosspostPoll", () => {
  it("appends the message id", async () => {
    const posted = await crosspostPoll(1, 700n);

    expect(posted.crosspost_message_ids).toEqual([700n]);
    expect(pollById(1).crosspost_message_ids).toEqual([700n]);
  });

  it("rejects re-crossposting the same message id with 400", async () => {
    await crosspostPoll(1, 700n);
    const dup = crosspostPoll(1, 700n);
    await expect(dup).rejects.toBeInstanceOf(BadRequestError);
    await expect(dup).rejects.toThrow(
      "Message already crossposted to this poll",
    );
    expect(pollById(1).crosspost_message_ids).toEqual([700n]); // unchanged
  });

  it("rejects unknown polls with 404", async () => {
    const missing = crosspostPoll(999, 700n);
    await expect(missing).rejects.toThrow("Poll with id 999 not found");
  });
});

describe("tightening: lifecycle-owned fields never editable via update", () => {
  const cases: Array<[string, unknown]> = [
    ["num", 5],
    ["message_id", "123456789012345678"],
    ["crosspost_message_ids", []], // present-but-empty still fails loudly
    ["fallback", true],
    ["guild_id", FIXTURE_GUILD_ID],
  ];

  /** Clean update body (no guild_id — that is the point). */
  const updateInput = (id: number, overrides: Partial<PollWriteInput> = {}) => ({
    id,
    question: `Q${id}`,
    choices: ["choice 0", "choice 1"],
    ...overrides,
  });

  it("updatePolls rejects each field naming the designated endpoint", async () => {
    for (const [field, value] of cases) {
      const rejected = updatePolls([
        updateInput(3, { [field]: value } as Partial<PollWriteInput>),
      ]);
      await expect(rejected).rejects.toBeInstanceOf(BadRequestError);
      await expect(rejected).rejects.toThrow(
        `'${field}' cannot be set via update; use the designated lifecycle endpoint`,
      );
    }
    // nothing written by any rejected call
    expect(pollById(3).num).toBeNull();
    expect(pollById(3).message_id).toBeNull();
  });

  it("the update route still accepts the editable fields (regression)", async () => {
    const updated = await updatePolls([
      updateInput(3, { question: "still editable", end_time: null }),
    ]);
    expect(updated[0].question).toBe("still editable");
  });
});

describe("bot lifecycle shims (POST /api/v1/bot/polls/:pollId/...)", () => {
  let app: Express;

  beforeAll(async () => {
    app = await createApp();
  });

  it("publish: 200 with the serialized poll (token only, no user header)", async () => {
    const response = await request(app)
      .post("/api/v1/bot/polls/3/publish")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({
        message_id: "900000000000000001",
        crosspost_message_ids: ["910000000000000001"],
      });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(3);
    expect(response.body.published).toBe(true);
    expect(response.body.num).toBe(2);
    expect(response.body.message_id).toBe("900000000000000001");
    expect(response.body.crosspost_message_ids).toEqual(["910000000000000001"]);
  });

  it("publish: idempotent at the route level", async () => {
    const first = await request(app)
      .post("/api/v1/bot/polls/3/publish")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ message_id: "900000000000000001", crosspost_message_ids: [] });

    const second = await request(app)
      .post("/api/v1/bot/polls/3/publish")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ message_id: "111", crosspost_message_ids: [] });

    expect(second.status).toBe(200);
    expect(second.body.num).toBe(first.body.num);
    expect(second.body.message_id).toBe("900000000000000001");
  });

  it("publish: invalid body -> 400", async () => {
    const response = await request(app)
      .post("/api/v1/bot/polls/3/publish")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ crosspost_message_ids: [] }); // message_id missing
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid publish body");
  });

  it("publish: unknown poll -> 404", async () => {
    const response = await request(app)
      .post("/api/v1/bot/polls/999/publish")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ message_id: "900000000000000001", crosspost_message_ids: [] });
    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Poll with id 999 not found");
  });

  it("end: 200 stamping end_time; second call keeps the first", async () => {
    const first = await request(app)
      .post("/api/v1/bot/polls/1/end")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(first.status).toBe(200);
    expect(first.body.end_time).not.toBeNull();

    const second = await request(app)
      .post("/api/v1/bot/polls/1/end")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(second.status).toBe(200);
    expect(second.body.end_time).toBe(first.body.end_time);
  });

  it("crosspost: 200 appending the message id; duplicate -> 400", async () => {
    const response = await request(app)
      .post("/api/v1/bot/polls/1/crosspost")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ message_id: "700" });
    expect(response.status).toBe(200);
    expect(response.body.crosspost_message_ids).toEqual(["700"]);

    const dup = await request(app)
      .post("/api/v1/bot/polls/1/crosspost")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ message_id: "700" });
    expect(dup.status).toBe(400);
    expect(dup.body.message).toBe("Message already crossposted to this poll");
  });

  it("requires the service token (401 without it)", async () => {
    const response = await request(app)
      .post("/api/v1/bot/polls/1/end")
      .set("X-Discord-User-Id", USER); // no Authorization header
    expect(response.status).toBe(401);
  });

  it("mounts no revalidation: a failing Discord lookup does not block", async () => {
    getGuildMemberRolesMock.mockReset();
    getGuildMemberRolesMock.mockRejectedValue(new Error("Discord down"));

    const response = await request(app)
      .post("/api/v1/bot/polls/3/publish")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ message_id: "900000000000000001", crosspost_message_ids: [] });

    expect(response.status).toBe(200); // not 503
    expect(response.body.published).toBe(true);
    expect(getGuildMemberRolesMock).not.toHaveBeenCalled();
  });
});

describe("tightening at the route level", () => {
  let app: Express;

  beforeAll(async () => {
    app = await createApp();
  });

  const cases: Array<[string, unknown]> = [
    ["num", 5],
    ["message_id", "123456789012345678"],
    ["crosspost_message_ids", []],
    ["fallback", true],
    ["guild_id", FIXTURE_GUILD_ID.toString()],
  ];

  it("/update rejects each field with the designated-endpoint message", async () => {
    for (const [field, value] of cases) {
      const response = await request(app)
        .post("/api/v1/bot/polls/update")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-Discord-User-Id", USER)
        .send([
          {
            id: 3,
            question: "Q3",
            choices: ["choice 0", "choice 1"],
            [field]: value,
          },
        ]);
      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        `'${field}' cannot be set via update; use the designated lifecycle endpoint`,
      );
    }
  });

  it("/update-by-tag rejects each field the same way", async () => {
    for (const [field, value] of cases) {
      const response = await request(app)
        .post("/api/v1/bot/polls/update-by-tag")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-Discord-User-Id", USER)
        .send({ tag: 2, [field]: value });
      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        `'${field}' cannot be set via update; use the designated lifecycle endpoint`,
      );
    }
    expect(pollById(3).num).toBeNull();
  });

  it("update-by-tag: other unknown fields keep the generic message", async () => {
    const response = await request(app)
      .post("/api/v1/bot/polls/update-by-tag")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-Discord-User-Id", USER)
      .send({ tag: 2, bogus: true });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Unknown fields: bogus");
  });
});
