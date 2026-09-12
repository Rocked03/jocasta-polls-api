import { prisma } from "@/client";
import { BadRequestError, NotFoundError } from "@/errors";
import {
  POLL_WITH_VOTES_INCLUDE,
  serializePoll,
} from "@/services/pollSerializer";
import type { Poll } from "@/types";

/**
 * Lifecycle transitions (publish/end/crosspost): the designated writers
 * for num, message_id, crosspost_message_ids, and start_time stamping.
 * All three are idempotent where the locked semantics demand it — a
 * second publish must NOT double-increment the tag counter, a second
 * end must NOT move end_time — and each returns the serialized poll.
 */

async function getPollWithVotes(pollId: number) {
  return prisma.poll.findUnique({
    where: { id: pollId },
    include: POLL_WITH_VOTES_INCLUDE,
  });
}

export interface PublishMessage {
  message_id: bigint;
  crosspost_message_ids: bigint[];
}

/**
 * Publishes a poll: atomically increments the tag's current_num and
 * stamps the Discord message state. Already-published polls return
 * their current state untouched (idempotent — no increment, no field
 * changes).
 *
 * Increment implementation choice: the typed `tag.update` with
 * `current_num: { increment: 1 }` is a single atomic UPDATE that
 * returns the updated row (Prisma supports the return), so no
 * `$queryRaw ... RETURNING` is needed — and the typed shape stays
 * mockable by the fixture prisma.
 */
export async function publishPoll(
  pollId: number,
  message: PublishMessage,
): Promise<Poll> {
  const poll = await getPollWithVotes(pollId);
  if (!poll) {
    throw new NotFoundError(`Poll with id ${pollId} not found`);
  }
  if (poll.published) {
    return serializePoll(poll);
  }
  if (poll.tag === null) {
    // Unreachable per schema (tag NOT NULL + FK), kept defensive for
    // the nullable-in-prisma edge the spec calls out.
    throw new NotFoundError(`Poll with id ${pollId} has no tag`);
  }

  const tag = await prisma.tag.update({
    where: { tag: poll.tag },
    data: { current_num: { increment: 1 } },
  });

  const updated = await prisma.poll.update({
    where: { id: pollId },
    data: {
      published: true,
      num: tag.current_num,
      message_id: message.message_id,
      crosspost_message_ids: message.crosspost_message_ids,
      start_time: poll.start_time ?? new Date(),
    },
    include: POLL_WITH_VOTES_INCLUDE,
  });
  console.log(`Published poll ${pollId} as num ${tag.current_num}`);
  return serializePoll(updated);
}

/**
 * Ends a poll: stamps end_time with now. An already-set end_time
 * returns the current state (idempotent — the first end time wins).
 */
export async function endPoll(pollId: number): Promise<Poll> {
  const poll = await getPollWithVotes(pollId);
  if (!poll) {
    throw new NotFoundError(`Poll with id ${pollId} not found`);
  }
  if (poll.end_time !== null) {
    return serializePoll(poll);
  }

  const updated = await prisma.poll.update({
    where: { id: pollId },
    data: { end_time: new Date() },
    include: POLL_WITH_VOTES_INCLUDE,
  });
  console.log(`Ended poll ${pollId}`);
  return serializePoll(updated);
}

/**
 * Appends a crosspost message id. Re-crossposting the same message id
 * is rejected with 400 (the caller must not mirror one message twice).
 */
export async function crosspostPoll(
  pollId: number,
  messageId: bigint,
): Promise<Poll> {
  const poll = await getPollWithVotes(pollId);
  if (!poll) {
    throw new NotFoundError(`Poll with id ${pollId} not found`);
  }
  if (poll.crosspost_message_ids.includes(messageId)) {
    throw new BadRequestError("Message already crossposted to this poll");
  }

  const updated = await prisma.poll.update({
    where: { id: pollId },
    data: { crosspost_message_ids: [...poll.crosspost_message_ids, messageId] },
    include: POLL_WITH_VOTES_INCLUDE,
  });
  console.log(`Crossposted poll ${pollId} to message ${messageId}`);
  return serializePoll(updated);
}
