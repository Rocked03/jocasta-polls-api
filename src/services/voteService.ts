import { prisma } from "@/client";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/errors";
import type { Vote } from "@/types";

export async function getVote(
  pollId: number,
  userId: bigint
): Promise<Vote | null> {
  const vote = await prisma.vote.findFirst({
    where: {
      poll_id: pollId,
      user_id: userId,
    },
  });

  if (!vote) return null;

  return vote;
}

export async function getVotesByPoll(
  pollId: number,
  managementOverride = false
): Promise<{ choice: number; votes: number }[] | null> {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { show_voting: true },
  });

  if (!poll) {
    throw new NotFoundError("Poll not found");
  }

  if (!poll.show_voting && !managementOverride) {
    throw new ForbiddenError("Votes are not visible for this poll");
  }

  const votes = await prisma.vote.groupBy({
    by: ["choice"],
    where: {
      poll_id: pollId,
    },
    _count: {
      choice: true,
    },
  });

  return votes.map((vote) => ({
    choice: vote.choice,
    votes: vote._count.choice,
  }));
}

export async function getVotesByUser(userId: bigint): Promise<Vote[]> {
  const votes = await prisma.vote.findMany({
    where: {
      user_id: userId,
    },
  });

  return votes;
}

export type CastVoteResult = {
  votes: number[];
  total_votes: number;
  had_vote: boolean;
  deleted: boolean;
};

/**
 * Casts, updates, or deletes a user's vote on a poll (upsert semantics:
 * a null choice deletes; an existing vote is updated in place), then
 * returns the poll's per-choice tallies. `had_vote`/`deleted` expose the
 * delete outcome so shims can phrase their messages; the tallies are
 * ALWAYS real counts (bot contract; no hidden-voting override here).
 * New-vote ids use userId * 100000n + pollId (poll ids are 5-digit, so
 * the encoding is provably unique; replaces the collision-prone sum).
 */
export async function castVote(
  pollId: number,
  userId: bigint,
  choice: number | null | undefined,
): Promise<CastVoteResult> {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { choices: true },
  });
  if (!poll) {
    throw new NotFoundError("Poll not found");
  }

  const existingVote = await prisma.vote.findFirst({
    where: { user_id: userId, poll_id: pollId },
  });
  const had_vote = existingVote !== null;

  let deleted = false;
  if (choice === null || choice === undefined) {
    if (existingVote) {
      await prisma.vote.deleteMany({
        where: { user_id: userId, poll_id: pollId },
      });
      deleted = true;
    }
  } else {
    if (choice < 0 || choice >= poll.choices.length) {
      throw new BadRequestError(`${choice} is not a valid choice`);
    }
    if (existingVote) {
      await prisma.vote.update({
        where: { id: existingVote.id },
        data: { choice },
      });
    } else {
      await prisma.vote.create({
        data: {
          id: userId * 100000n + BigInt(pollId),
          user_id: userId,
          poll_id: pollId,
          choice,
        },
      });
    }
  }

  const rows = await prisma.vote.findMany({
    where: { poll_id: pollId },
    select: { choice: true },
  });
  // Defensive bounds handling mirrors serializePoll: out-of-range rows
  // still count toward total_votes but no per-choice bucket.
  const votes = new Array<number>(poll.choices.length).fill(0);
  for (const row of rows) {
    if (row.choice >= 0 && row.choice < votes.length) {
      votes[row.choice] += 1;
    }
  }
  return { votes, total_votes: rows.length, had_vote, deleted };
}
