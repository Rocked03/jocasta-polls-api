import { type Poll as PollModel } from "@/generated/prisma/client";

import type { Poll } from "@/types";

/**
 * Extended poll type that includes vote relation data for processing
 */
export type PollWithVotes = PollModel & {
  votes: { choice: number }[];
  tagRelation?: unknown;
};

/**
 * The include shape that feeds serializePoll: the vote relation (tallied
 * per choice) plus the tag relation. Shared by every poll write and
 * lifecycle query so the serialization contract has one source of truth.
 */
export const POLL_WITH_VOTES_INCLUDE = {
  tagRelation: true,
  votes: {
    select: {
      choice: true,
    },
  },
} as const;

/**
 * Derives poll activity from timestamps: a poll is active when it is
 * published, has started, and has not ended. Open-ended polls (NULL
 * end_time) stay active once started. At `now === end_time` exactly the
 * poll is inactive.
 */
export function computeActive(
  poll: Pick<PollModel, "published" | "start_time" | "end_time">,
  now: Date = new Date(),
): boolean {
  return (
    poll.published &&
    poll.start_time !== null &&
    poll.start_time <= now &&
    (poll.end_time === null || poll.end_time > now)
  );
}

/**
 * Serializes a poll with its vote relation into the API contract shape:
 * tallies votes per choice, emits start_time/end_time, derives `active`
 * from the timestamps (the model no longer stores it), and keeps time as
 * the compatibility alias for start_time (website; removable post-migration)
 */
export function serializePoll(poll: PollWithVotes, now: Date = new Date()): Poll {
  const { votes, start_time, end_time, tagRelation, ...restPoll } = poll;
  const totalVotes = votes.length;
  const voteCounts = new Array<number>(restPoll.choices.length).fill(0);
  for (const vote of votes) {
    if (vote.choice >= 0 && vote.choice < voteCounts.length) {
      voteCounts[vote.choice] += 1;
    }
  }
  return {
    ...restPoll,
    active: computeActive(poll, now),
    votes: voteCounts,
    total_votes: totalVotes,
    start_time,
    end_time,
    time: start_time,
  };
}
