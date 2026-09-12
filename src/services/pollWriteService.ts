import config from "@/config";
import { prisma } from "@/client";
import { ApiError, BadRequestError, NotFoundError } from "@/errors";
import { Prisma } from "@/generated/prisma/client";
import { getPollsFromList } from "@/services/pollReadService";
import {
  POLL_WITH_VOTES_INCLUDE,
  type PollWithVotes,
} from "@/services/pollSerializer";
import { getTags } from "@/services/tagService";
import {
  type PollTimeInput,
  type PollWriteInput,
  coerceDate,
  resolveStartTime,
  validatePoll,
  validatePublishedPoll,
} from "@/utils/validatePoll";

/**
 * Fields explicitly editable via /update. Everything else on the model
 * is restricted — a NEW field added to the schema defaults to restricted
 * until explicitly opted in here (fail-safe against drift).
 */
const EDITABLE_UPDATE_FIELDS = new Set<keyof typeof Prisma.PollScalarFieldEnum>(
  [
    "id", // lookup key, validated separately
    "question",
    "description",
    "image",
    "thread_question",
    "show_question",
    "show_options",
    "show_voting",
    "choices",
    "tag",
    "start_time",
    "end_time",
  ],
);

/**
 * Fields that only the lifecycle endpoints may write (publish owns
 * num/message_id/crosspost_message_ids/published, create owns guild_id
 * and fallback), derived from the Prisma model so schema changes can't
 * drift. Their presence in an update body fails loudly with the
 * designated-endpoint message instead of silently stripping.
 */
export const RESTRICTED_UPDATE_FIELDS = (
  Object.keys(
    Prisma.PollScalarFieldEnum,
  ) as (keyof typeof Prisma.PollScalarFieldEnum)[]
).filter((field) => !EDITABLE_UPDATE_FIELDS.has(field));

export function assertNoRestrictedUpdateFields(input: object): void {
  const record = input as Record<string, unknown>;
  for (const field of RESTRICTED_UPDATE_FIELDS) {
    if (record[field] !== undefined) {
      throw new BadRequestError(
        `'${field}' cannot be set via update; use the designated lifecycle endpoint`,
      );
    }
  }
}

/**
 * Whitelisted bulk-update fields for updatePollsByTag: the update
 * route's accepted body minus num/message_id/crosspost_message_ids
 * (publish-side state) and tag (inherently unchanged when updating by
 * tag).
 */
export interface PollTagUpdateFields {
  question?: string;
  description?: string | null;
  image?: string | null;
  thread_question?: string | null;
  show_question?: boolean;
  show_options?: boolean;
  show_voting?: boolean;
  time?: PollTimeInput;
  start_time?: PollTimeInput;
  end_time?: PollTimeInput;
}

/**
 * Normalized write input: JSON bodies carry guild ids as strings, so
 * they are converted to bigint before validation (extracted from the
 * old routes).
 */
type NormalizedPollInput = PollWriteInput & { guild_id?: bigint };

function normalizePollGuildId(poll: PollWriteInput): NormalizedPollInput {
  return {
    ...poll,
    guild_id:
      typeof poll.guild_id === "string" ? BigInt(poll.guild_id) : poll.guild_id,
  };
}

/**
 * Creates polls: bulk validation (shape, required tag, guild scope, tag
 * existence), unique random 5-digit ids, `published: false` like the
 * bot, and `end_time` alongside the `time`/`start_time` alias rule.
 * Returns the created models with their (empty) vote relation; routes
 * serialize.
 */
export async function createPolls(
  pollsData: PollWriteInput[],
): Promise<PollWithVotes[]> {
  if (!Array.isArray(pollsData) || pollsData.length === 0) {
    throw new BadRequestError("pollsData must be a non-empty array");
  }

  // Convert string guild_id to bigint before validation
  const normalizedPollsData = pollsData.map(normalizePollGuildId);

  const tags = await getTags();

  normalizedPollsData.forEach((poll) => {
    validatePoll(poll);

    if (poll.tag === undefined) {
      throw new BadRequestError("Poll tag is required");
    }

    if (poll.guild_id === undefined) {
      throw new BadRequestError("Poll guild_id must be a valid bigint");
    }

    if (poll.guild_id !== config.guildId) {
      throw new ApiError("Cannot create polls for other guilds", 403);
    }

    if (!tags.some((tag) => tag.tag === poll.tag)) {
      throw new NotFoundError(`Tag with id ${poll.tag} not found`);
    }

    resolveStartTime(poll);
  });

  // Generate unique poll IDs and create polls
  const createdPolls = await Promise.all(
    normalizedPollsData.map(async (poll) => {
      // Generate unique poll ID (matching bot logic)
      let pollId: number;
      while (true) {
        pollId = Math.floor(Math.random() * 90000) + 10000; // 10000-99999
        const existing = await prisma.poll.findUnique({
          where: { id: pollId },
        });
        if (!existing) break;
      }

      const startInput = resolveStartTime(poll);
      return await prisma.poll.create({
        data: {
          id: pollId,
          question: poll.question!,
          published: false, // Always false initially like bot
          guild_id: poll.guild_id!,
          choices: poll.choices!,
          start_time: startInput ? new Date(startInput) : null,
          end_time: poll.end_time ? new Date(poll.end_time) : null,
          num: null, // Set later when published
          message_id: null, // Set later when published
          crosspost_message_ids: [], // Empty initially
          tag: poll.tag!,
          image: poll.image || null,
          description: poll.description || null,
          thread_question: poll.thread_question || null,
          show_question: poll.show_question ?? true,
          show_options: poll.show_options ?? true,
          show_voting: poll.show_voting ?? true,
          fallback: false, // Not client-settable; no API write path
        },
        include: POLL_WITH_VOTES_INCLUDE,
      });
    }),
  );

  console.log(
    `Created ${createdPolls.length} polls: ${createdPolls
      .map((p) => `"${p.question}"`)
      .join(", ")}`,
  );
  return createdPolls;
}

/**
 * Updates polls by id: bulk shape/guild validation, existence check, the
 * post-publish field matrix, then the update mapping (start_time
 * resolved via the `time` alias; end_time freely editable in any
 * state). The lifecycle-owned fields (num/message_id/crossposts) plus
 * guild_id and fallback are rejected up front — publish/end/crosspost
 * are their designated writers, create sets guild_id/fallback — and
 * guild scoping is checked against the EXISTING polls since the input
 * no longer carries guild_id. Returns the updated models with their
 * vote relation; routes serialize.
 */
export async function updatePolls(
  pollsData: PollWriteInput[],
): Promise<PollWithVotes[]> {
  if (!Array.isArray(pollsData) || pollsData.length === 0) {
    throw new BadRequestError("pollsData must be a non-empty array");
  }

  pollsData.forEach((poll) => {
    // Fail fast on lifecycle-owned fields before any validation reads them
    assertNoRestrictedUpdateFields(poll);

    validatePoll(poll);

    resolveStartTime(poll);
  });

  const existingPolls = await getPollsFromList(
    pollsData.map((poll) => poll.id!),
    true,
  );
  if (existingPolls.length !== pollsData.length) {
    throw new NotFoundError("One or more polls not found");
  }

  if (existingPolls.some((poll) => poll.guild_id !== config.guildId)) {
    throw new ApiError("Cannot update polls for other guilds", 403);
  }

  const tags = await getTags();
  pollsData.forEach((poll) => {
    validatePublishedPoll(poll, existingPolls.find((p) => p.id === poll.id)!);

    if (poll.tag !== undefined && !tags.some((tag) => tag.tag === poll.tag)) {
      throw new NotFoundError(`Tag with id ${poll.tag} not found`);
    }
  });

  // Update polls in database
  const updatedPolls = await Promise.all(
    pollsData.map(async (poll) => {
      const existingPoll = existingPolls.find((p) => p.id === poll.id);
      if (!existingPoll) {
        throw new NotFoundError(`Poll with id ${poll.id} not found`);
      }

      const resolvedStart = resolveStartTime(poll);
      return await prisma.poll.update({
        where: { id: poll.id! },
        data: {
          question: poll.question,
          choices: poll.choices,
          tag: poll.tag,
          image: poll.image,
          description: poll.description,
          thread_question: poll.thread_question,
          show_question: poll.show_question,
          show_options: poll.show_options,
          show_voting: poll.show_voting,
          ...(resolvedStart !== undefined && {
            start_time: coerceDate(resolvedStart),
          }),
          ...(poll.end_time !== undefined && {
            end_time: coerceDate(poll.end_time),
          }),
          // Preserve published state from existing poll
          published: existingPoll.published,
        },
        include: POLL_WITH_VOTES_INCLUDE,
      });
    }),
  );
  console.log(
    `Updated ${updatedPolls.length} polls: ${updatedPolls
      .map((p) => `"${p.question}"`)
      .join(", ")}`,
  );
  return updatedPolls;
}

/**
 * Deletes unpublished polls of this guild by id. Votes cascade via the
 * poll FK, so a single poll.deleteMany replaces the old explicit
 * vote-then-poll transaction. Returns the deleteMany result ({ count }).
 */
export async function deletePolls(
  pollIds: Array<string | number>,
): Promise<{ count: number }> {
  if (!Array.isArray(pollIds) || pollIds.length === 0) {
    throw new BadRequestError("pollIds must be a non-empty array");
  }
  const ids = pollIds.map(Number);

  // fetches the polls to ensure they exist and the user has permission to delete them
  const polls = await getPollsFromList(ids, true);
  if (polls.length !== ids.length) {
    throw new NotFoundError("One or more polls not found");
  }

  if (polls.some((poll) => poll.published)) {
    throw new ApiError("Cannot delete published polls", 403);
  }

  if (polls.some((poll) => poll.guild_id !== config.guildId)) {
    throw new ApiError("Cannot delete polls from other guilds", 403);
  }

  // Delete polls; related votes cascade via FK
  const deletedPolls = await prisma.poll.deleteMany({
    where: {
      id: {
        in: ids,
      },
    },
  });

  if (deletedPolls.count === 0) {
    throw new NotFoundError("No polls found with the provided IDs");
  }

  console.log(`Deleted ${deletedPolls.count} polls with IDs: ${ids.join(", ")}`);
  return deletedPolls;
}

/**
 * Bulk-updates every poll of a tag with the same whitelisted fields.
 * The field matrix applies per poll (start_time frozen once published;
 * the tag itself never changes here), and every poll is validated
 * BEFORE any write, so one rejection fails the whole batch. Returns the
 * updated models with their vote relation; routes serialize.
 */
export async function updatePollsByTag(
  tag: number,
  fields: PollTagUpdateFields,
): Promise<PollWithVotes[]> {
  const resolvedStart = resolveStartTime(fields);

  const polls = await prisma.poll.findMany({
    where: { guild_id: config.guildId, tag },
    include: {
      votes: {
        select: {
          choice: true,
        },
      },
    },
  });

  // All-or-nothing: validate every poll before writing any
  polls.forEach((poll) => {
    validatePublishedPoll(fields, poll);
  });

  const updatedPolls = await Promise.all(
    polls.map((poll) =>
      prisma.poll.update({
        where: { id: poll.id },
        data: {
          ...(fields.question !== undefined && { question: fields.question }),
          ...(fields.description !== undefined && {
            description: fields.description,
          }),
          ...(fields.image !== undefined && { image: fields.image }),
          ...(fields.thread_question !== undefined && {
            thread_question: fields.thread_question,
          }),
          ...(fields.show_question !== undefined && {
            show_question: fields.show_question,
          }),
          ...(fields.show_options !== undefined && {
            show_options: fields.show_options,
          }),
          ...(fields.show_voting !== undefined && {
            show_voting: fields.show_voting,
          }),
          ...(resolvedStart !== undefined && {
            start_time: coerceDate(resolvedStart),
          }),
          ...(fields.end_time !== undefined && {
            end_time: coerceDate(fields.end_time),
          }),
        },
        include: POLL_WITH_VOTES_INCLUDE,
      }),
    ),
  );

  console.log(
    `Updated ${updatedPolls.length} polls by tag ${tag}: ${updatedPolls
      .map((p) => `"${p.question}"`)
      .join(", ")}`,
  );
  return updatedPolls;
}
