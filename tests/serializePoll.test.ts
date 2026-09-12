import { describe, expect, it } from "vitest";

import { serializePoll } from "@/services/pollSerializer";

const BASE_POLL = {
  id: 42,
  question: "Best hero?",
  published: true,
  guild_id: BigInt("123456789"),
  choices: ["A", "B", "C"],
  start_time: new Date("2026-01-01T12:00:00Z"),
  end_time: new Date("2026-01-08T12:00:00Z"),
  num: 7,
  message_id: BigInt("998877"),
  crosspost_message_ids: [BigInt("111"), BigInt("222")],
  tag: 3,
  image: null,
  description: "desc",
  thread_question: null,
  show_question: true,
  show_options: true,
  show_voting: true,
  fallback: false,
};

type PollFixture = Omit<typeof BASE_POLL, "start_time" | "end_time"> & {
  start_time: Date | null;
  end_time: Date | null;
  votes: { choice: number }[];
  tagRelation?: null;
};

function makePoll(overrides: Partial<PollFixture> = {}): PollFixture {
  return { ...BASE_POLL, votes: [], ...overrides };
}

const CONTRACT_KEYS = [
  "id",
  "question",
  "published",
  "active",
  "guild_id",
  "choices",
  "num",
  "message_id",
  "crosspost_message_ids",
  "tag",
  "image",
  "description",
  "thread_question",
  "show_question",
  "show_options",
  "show_voting",
  "fallback",
  "votes",
  "total_votes",
  "start_time",
  "end_time",
  "time",
].sort();

describe("serializePoll", () => {
  it("emits start_time, end_time, and the time compatibility alias", () => {
    const poll = makePoll({ votes: [{ choice: 0 }] });
    const result = serializePoll(poll);

    expect(result.start_time).toBe(poll.start_time);
    expect(result.end_time).toBe(poll.end_time);
    expect(result.time).toBe(result.start_time);
  });

  it("tallies votes per choice and total_votes from the relation", () => {
    const poll = makePoll({
      votes: [{ choice: 0 }, { choice: 1 }, { choice: 1 }, { choice: 2 }, { choice: 1 }],
    });
    const result = serializePoll(poll);

    expect(result.votes).toEqual([1, 3, 1]);
    expect(result.total_votes).toBe(5);
  });

  it("returns a zero-filled array sized to choices for a zero-vote poll", () => {
    const poll = makePoll({ choices: ["W", "X", "Y", "Z"], votes: [] });
    const result = serializePoll(poll);

    expect(result.votes).toEqual([0, 0, 0, 0]);
    expect(result.total_votes).toBe(0);
  });

  it("ignores out-of-range choice indices in the tally", () => {
    const poll = makePoll({
      choices: ["A", "B"],
      votes: [{ choice: 0 }, { choice: 5 }, { choice: -1 }],
    });
    const result = serializePoll(poll);

    expect(result.votes).toEqual([1, 0]);
    expect(result.total_votes).toBe(3);
  });

  it("passes null start/end through and strips relation fields from output", () => {
    const poll = makePoll({
      start_time: null,
      end_time: null,
      votes: [{ choice: 2 }],
      tagRelation: null,
    });
    const result = serializePoll(poll);

    expect(result.start_time).toBeNull();
    expect(result.end_time).toBeNull();
    expect(result.time).toBeNull();
    expect(Object.keys(result).sort()).toEqual(CONTRACT_KEYS);
    expect(result).not.toHaveProperty("tagRelation");
    expect(result.votes).toEqual([0, 0, 1]);
    expect(result.votes?.every((count) => typeof count === "number")).toBe(true);
  });

  it("passes end_time through unchanged", () => {
    const end = new Date("2030-06-15T00:00:00Z");
    const poll = makePoll({ end_time: end, votes: [] });
    const result = serializePoll(poll);

    expect(result.end_time).toBe(end);
  });

  it("derives active=true while started and not ended (injected now)", () => {
    const poll = makePoll({ votes: [] });
    const now = new Date("2026-01-04T12:00:00Z");

    expect(serializePoll(poll, now).active).toBe(true);
  });

  it("derives active=false before the start time", () => {
    const poll = makePoll({ votes: [] });
    const now = new Date("2025-12-25T12:00:00Z");

    expect(serializePoll(poll, now).active).toBe(false);
  });

  it("derives active=false for unpublished polls regardless of timing", () => {
    const poll = makePoll({ published: false, votes: [] });
    const now = new Date("2026-01-04T12:00:00Z");

    expect(serializePoll(poll, now).active).toBe(false);
  });

  it("derives active=true for open-ended polls once started (end null)", () => {
    const poll = makePoll({ end_time: null, votes: [] });
    const now = new Date("2030-01-01T00:00:00Z");

    expect(serializePoll(poll, now).active).toBe(true);
  });

  it("derives active=false at exactly the end time", () => {
    const poll = makePoll({ votes: [] });
    const now = new Date("2026-01-08T12:00:00Z");

    expect(serializePoll(poll, now).active).toBe(false);
  });

  it("derives active=false without a start time", () => {
    const poll = makePoll({ start_time: null, end_time: null, votes: [] });
    const now = new Date("2026-01-04T12:00:00Z");

    expect(serializePoll(poll, now).active).toBe(false);
  });

  it("emits tag as a non-null number", () => {
    const poll = makePoll({ votes: [] });
    const result = serializePoll(poll, new Date("2026-01-04T12:00:00Z"));

    expect(result.tag).toBe(3);
    expect(typeof result.tag).toBe("number");
  });
});
