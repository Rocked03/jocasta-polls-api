import { BadRequestError } from "@/errors";
import { Poll } from "@/types";

/** Timestamp accepted on poll write inputs (ISO string or Date instance). */
export type PollTimeInput = Date | string | null;

/**
 * Write-input shape accepted by the poll write services. `time` is the
 * legacy alias for `start_time`; ids may arrive as strings via JSON
 * bodies (guild_id, message_id, crosspost ids).
 */
export interface PollWriteInput {
  id?: number;
  question?: string;
  guild_id?: bigint | string;
  choices?: string[];
  tag?: number;
  image?: string | null;
  description?: string | null;
  thread_question?: string | null;
  show_question?: boolean;
  show_options?: boolean;
  show_voting?: boolean;
  fallback?: boolean;
  time?: PollTimeInput;
  start_time?: PollTimeInput;
  end_time?: PollTimeInput;
  num?: number;
  message_id?: string | bigint | null;
  crosspost_message_ids?: Array<string | bigint>;
}

/**
 * Coerces a time input to a Date (JSON strings or Date instances);
 * null stays null.
 */
export function coerceDate(value: PollTimeInput): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function millisOf(
  value: PollTimeInput | undefined,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.getTime();
}

/**
 * Resolves the effective start time: `start_time` wins, `time` is the
 * legacy alias. Providing BOTH with different instants is a 400
 * ("'time' and 'start_time' conflict; provide one"); equal values pass.
 */
export function resolveStartTime(poll: {
  time?: PollTimeInput;
  start_time?: PollTimeInput;
}): PollTimeInput | undefined {
  if (
    poll.time !== undefined &&
    poll.start_time !== undefined &&
    millisOf(poll.time) !== millisOf(poll.start_time)
  ) {
    throw new BadRequestError("'time' and 'start_time' conflict; provide one");
  }
  return poll.start_time ?? poll.time;
}

export function validatePoll(poll: PollWriteInput) {
  if (!poll) {
    throw new BadRequestError("Poll cannot be null or undefined");
  }

  if (typeof poll.question !== "string" || poll.question.trim() === "") {
    throw new BadRequestError("Poll question must be a non-empty string");
  }

  if (
    !Array.isArray(poll.choices) ||
    poll.choices.length < 1 ||
    poll.choices.length > 8
  ) {
    throw new BadRequestError("Poll choices must be an array with 1 to 8 items");
  }

  if (
    poll.choices.some(
      (choice) => typeof choice !== "string" || choice.trim() === "",
    )
  ) {
    throw new BadRequestError("All poll choices must be non-empty strings");
  }

  // Shape check only: presence is create's concern — tightened update
  // inputs must omit guild_id entirely (see assertNoRestrictedUpdateFields).
  if (poll.guild_id !== undefined && typeof poll.guild_id !== "bigint") {
    throw new BadRequestError("Poll guild_id must be a valid bigint");
  }

  if (
    poll.tag !== undefined &&
    (typeof poll.tag !== "number" || poll.tag < 0)
  ) {
    throw new BadRequestError("Poll tag must be a non-negative number");
  }
}

/**
 * Post-publish immutability matrix: once published, a poll's choices
 * LENGTH, tag, and start time are frozen (omit = keep; choices CONTENT
 * and end_time stay editable in any state). The existing poll is a
 * serialized post-L3 poll, so its `start_time` is the comparison truth;
 * the incoming start time resolves through the `time` alias first.
 */
export function validatePublishedPoll(
  newPoll: PollWriteInput,
  existingPoll: Pick<Poll, "published" | "choices" | "tag" | "start_time">,
) {
  if (!existingPoll.published) return;

  if (
    newPoll.choices !== undefined &&
    newPoll.choices.length !== existingPoll.choices.length
  ) {
    throw new BadRequestError(
      "Cannot change the number of choices for a published poll",
    );
  }

  if (newPoll.tag !== undefined && newPoll.tag !== existingPoll.tag) {
    throw new BadRequestError("Cannot change the tag of a published poll");
  }

  const newStart = millisOf(resolveStartTime(newPoll));
  if (
    newStart !== undefined &&
    newStart !== millisOf(existingPoll.start_time)
  ) {
    throw new BadRequestError("Cannot change the time of a published poll");
  }
}
