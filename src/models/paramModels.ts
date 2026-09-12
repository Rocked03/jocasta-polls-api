import { BadRequestError } from "@/errors";
import type { Poll, Tag, Vote } from "@/types";
import { z } from "zod";
import { OrderType, OrderDir } from "@/types";

const BooleanFilter = z
  .string()
  .toLowerCase()
  .refine((val) => val === "true" || val === "false", {
    message: "Must be 'true' or 'false'",
  })
  .transform((val) => (val ? val === "true" : undefined))
  .optional();

const IntFilter = z.coerce.number().int().positive();

const BigIntFilter = z.coerce.bigint().positive();

const GuildIdParamModel = z.object({
  guildId: BigIntFilter,
});

const PollIdParamModel = z.object({
  pollId: IntFilter,
});

const TagIdParamModel = z.object({
  id: IntFilter,
});

const UserIdParamModel = z.object({
  userId: BigIntFilter,
});

const ChoiceParamModel = z.object({
  choice: z.coerce.number().int().min(0).max(7).nullable(),
});

const PaginationModel = z.object({
  page: IntFilter.optional(),
  limit: IntFilter.optional(),
});

const PollFilterParamsModel = z
  .object({
    published: BooleanFilter.optional(),
    tag: IntFilter.optional(),
    userId: BigIntFilter.optional(),
    notVoted: BooleanFilter,
    search: z.coerce.string().optional(),
    // ordering: one of 'time' | 'votes' | 'random'
    order: z
      .enum([OrderType.Time, OrderType.Votes, OrderType.Random])
      .optional(),
    // direction for time/votes: 'asc'|'desc'
    orderDir: z.enum([OrderDir.Asc, OrderDir.Desc]).optional(),
    // seed for random ordering (string form will be coerced to number)
    seed: z.string().optional(),
    // comma-separated poll ids, e.g. ids=12345,67890
    ids: z
      .string()
      .refine((val) => /^(\d+)(,\d+)*$/.test(val), {
        message: "ids must be a comma-separated list of positive integers",
      })
      .transform((val) => val.split(",").map(Number))
      .optional(),
    num: IntFilter.optional(),
    active: BooleanFilter.optional(),
    has_start: BooleanFilter.optional(),
    has_end: BooleanFilter.optional(),
    live: BooleanFilter.optional(),
    ...PaginationModel.shape,
  })
  .refine((data) => !(data.notVoted && !data.userId), {
    message: "'notVoted' requires 'userId' to be specified",
    path: ["notVoted"],
  });

export interface GuildIdParams {
  guildId: string;
}

export async function parseGuildId(
  params: unknown
): Promise<Poll["guild_id"]> {
  const result = await GuildIdParamModel.safeParseAsync(params);
  if (!result.success) {
    throw new BadRequestError(
      `${String((params as Record<string, unknown>).guildId)} is not a valid guild id`,
      result.error.issues
    );
  }

  return BigInt(result.data.guildId);
}

export interface PollIdParams {
  pollId: string;
}

export async function parsePollId(params: unknown): Promise<Poll["id"]> {
  const result = await PollIdParamModel.safeParseAsync(params);
  if (!result.success) {
    throw new BadRequestError(
      `${String((params as Record<string, unknown>).pollId)} is not a valid poll id`,
      result.error.issues
    );
  }

  return result.data.pollId;
}

export interface PollFilterParams {
  published?: boolean;
  tag?: number;
  userId?: bigint;
  notVoted?: boolean;
  search?: string;
  ids?: number[];
  num?: number;
  active?: boolean;
  has_start?: boolean;
  has_end?: boolean;
  live?: boolean;

  page?: number;
  limit?: number;
  order?: OrderType;
  orderDir?: OrderDir;
  seed?: number;
}

export async function parsePollFilterParams(
  params: unknown
): Promise<PollFilterParams> {
  const result = await PollFilterParamsModel.safeParseAsync(params);

  if (!result.success) {
    throw new BadRequestError(
      "Invalid poll filter parameters",
      result.error.issues
    );
  }

  // Cross-param validation: 'ids' and 'userId' each constrain the poll id
  // set in incompatible ways, so combining them is rejected outright.
  if (result.data.ids !== undefined && result.data.userId !== undefined) {
    throw new BadRequestError("'ids' cannot be combined with 'userId'");
  }

  // Additional validation for orderDir/seed depending on order
  const parsed: PollFilterParams = {
    published: result.data.published,
    tag: result.data.tag,
    userId: result.data.userId,
    notVoted: result.data.notVoted,
    search: result.data.search,
    ids: result.data.ids,
    num: result.data.num,
    active: result.data.active,
    has_start: result.data.has_start,
    has_end: result.data.has_end,
    live: result.data.live,
    page: result.data.page,
    limit: result.data.limit,
  };

  if (result.data.order) {
    parsed.order = result.data.order;

    // validate orderDir/seed
    if (result.data.order === "random") {
      if (
        result.data.num !== undefined ||
        result.data.active !== undefined ||
        result.data.has_start !== undefined ||
        result.data.has_end !== undefined ||
        result.data.live !== undefined
      ) {
        throw new BadRequestError(
          "'num', 'active', 'live', 'has_start', and 'has_end' are not supported with order=random"
        );
      }
      if (result.data.seed !== undefined) {
        if (!/^-?\d+$/.test(result.data.seed)) {
          throw new BadRequestError("seed must be an integer for random order");
        }
        parsed.seed = Number(result.data.seed);
      }
    } else {
      if (result.data.orderDir !== undefined) {
        const low = result.data.orderDir as string;
        if (low !== OrderDir.Asc && low !== OrderDir.Desc) {
          throw new BadRequestError(
            "orderDir must be 'asc' or 'desc' for time/votes order"
          );
        }
        parsed.orderDir = low === OrderDir.Asc ? OrderDir.Asc : OrderDir.Desc;
      }
    }
  } else if (result.data.orderDir || result.data.seed) {
    // orderDir/seed specified without order is invalid
    throw new BadRequestError(
      "'orderDir' or 'seed' is only valid when 'order' is specified"
    );
  }

  return parsed;
}

export interface TagIdParams {
  id: string;
}

export async function parseTagId(params: unknown): Promise<Tag["tag"]> {
  const result = await TagIdParamModel.safeParseAsync(params);
  if (!result.success) {
    throw new BadRequestError(
      `${String((params as Record<string, unknown>).id)} is not a valid tag id`,
      result.error.issues
    );
  }

  return result.data.id;
}

const TagFilterParamsModel = z.object({
  end_message_self_assign: BooleanFilter,
  end_message_replace: BooleanFilter,
});

export interface TagFilterParams {
  end_message_self_assign?: string;
  end_message_replace?: string;
}

export async function parseTagFilterParams(
  params: unknown
): Promise<{ end_message_self_assign?: boolean; end_message_replace?: boolean }> {
  const result = await TagFilterParamsModel.safeParseAsync(params);
  if (!result.success) {
    throw new BadRequestError(
      "Invalid tag filter parameters",
      result.error.issues
    );
  }

  return result.data;
}

const GuildFilterParamsModel = z.object({
  manage_channel_id: BigIntFilter.optional(),
});

export interface GuildFilterParams {
  manage_channel_id?: string;
}

export async function parseGuildFilterParams(
  params: unknown
): Promise<{ manage_channel_id?: bigint }> {
  const result = await GuildFilterParamsModel.safeParseAsync(params);
  if (!result.success) {
    throw new BadRequestError(
      "Invalid guild filter parameters",
      result.error.issues
    );
  }

  return result.data;
}

export interface UserIdParams {
  userId: string;
}

export async function parseUserId(
  params: unknown
): Promise<Vote["user_id"]> {
  const result = await UserIdParamModel.safeParseAsync(params);
  if (!result.success) {
    throw new BadRequestError(
      `${String((params as Record<string, unknown>).userId)} is not a valid user id`,
      result.error.issues
    );
  }

  return result.data.userId;
}

/**
 * Bot lifecycle bodies: snowflakes arrive as strings via JSON, coerced
 * to bigint (publish carries the initial crosspost id array; crosspost
 * appends one; end takes no body at all).
 */
const PublishBodyModel = z.object({
  message_id: BigIntFilter,
  crosspost_message_ids: z.array(BigIntFilter),
});

const CrosspostBodyModel = z.object({
  message_id: BigIntFilter,
});

export interface PublishBody {
  message_id: string | bigint;
  crosspost_message_ids: Array<string | bigint>;
}

export interface CrosspostBody {
  message_id: string | bigint;
}

const UpdateTagBodyModel = z
  .object({
    tag: z.coerce.number().int().positive(),
    name: z.string().optional(),
    channel_id: BigIntFilter.optional(),
    crosspost_channels: z.array(BigIntFilter).optional(),
    crosspost_servers: z.array(BigIntFilter).optional(),
    colour: z.coerce.number().int().nullable().optional(),
    end_message: z.string().nullable().optional(),
    end_message_latest_ids: z.array(BigIntFilter).optional(),
    end_message_replace: z.boolean().optional(),
    end_message_role_ids: z.array(BigIntFilter).optional(),
    end_message_ping: z.boolean().optional(),
    end_message_self_assign: z.boolean().optional(),
    persistent: z.boolean().optional(),
  })
  .strict();

export interface ParsedUpdateTagBody {
  tag: number;
  name?: string;
  channel_id?: bigint;
  crosspost_channels?: bigint[];
  crosspost_servers?: bigint[];
  colour?: number | null;
  end_message?: string | null;
  end_message_latest_ids?: bigint[];
  end_message_replace?: boolean;
  end_message_role_ids?: bigint[];
  end_message_ping?: boolean;
  end_message_self_assign?: boolean;
  persistent?: boolean;
}

export function parseUpdateTagBody(body: unknown): ParsedUpdateTagBody {
  const result = UpdateTagBodyModel.safeParse(body);
  if (!result.success) {
    throw new BadRequestError("Invalid tag update body", result.error.issues);
  }
  return result.data;
}

export async function parsePublishBody(body: unknown): Promise<{
  message_id: bigint;
  crosspost_message_ids: bigint[];
}> {
  const result = await PublishBodyModel.safeParseAsync(body);
  if (!result.success) {
    throw new BadRequestError("Invalid publish body", result.error.issues);
  }
  return result.data;
}

export async function parseCrosspostBody(
  body: unknown,
): Promise<{ message_id: bigint }> {
  const result = await CrosspostBodyModel.safeParseAsync(body);
  if (!result.success) {
    throw new BadRequestError("Invalid crosspost body", result.error.issues);
  }
  return result.data;
}

export interface VoteParams {
  choice: string;
}

export async function parseChoice(
  params: unknown
): Promise<Vote["choice"] | null> {
  const result = await ChoiceParamModel.safeParseAsync(params);
  if (!result.success) {
    throw new BadRequestError(
      `${String((params as Record<string, unknown>).choice)} is not a valid choice`,
      result.error.issues
    );
  }

  return result.data.choice;
}
