import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/client";
import { type PollFilterUser, buildPollAuxFilters } from "@/services/pollFilters";
import { serializePoll } from "@/services/pollSerializer";
import type { Meta, Poll } from "@/types";
import { OrderDir, OrderType } from "@/types";

/**
 * Comprehensive filtering and pagination options for poll queries
 */
interface PollFilters {
  guildId: bigint;
  published?: boolean;
  tag?: number;
  ids?: number[];
  num?: number;
  active?: boolean;
  has_start?: boolean;
  has_end?: boolean;
  live?: boolean;
  user?: PollFilterUser;
  search?: string;
  page?: number;
  limit?: number;
  managementOverride?: boolean; // Overrides hidden votes visibility
  order?: OrderType;
  orderDir?: OrderDir;
  seed?: number;
}

/**
 * Sanitizes search input for safe use in database queries
 */
function sanitizeSearchInput(input: string): string {
  return input
    .toLowerCase()
    .replace(/([&|!()"'`])/g, "\\$1") // Escape special characters
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .split(" ")
    .filter(Boolean) // Remove empty strings
    .join(" ");
}

/**
 * Creates pagination metadata for API responses
 */
function createPaginationMeta(
  total: number,
  page: number,
  limit: number,
  randomSeed?: number
): Meta {
  const totalPages = Math.ceil(total / limit);
  const nextPage = page < totalPages ? page + 1 : null;
  const prevPage = page > 1 ? page - 1 : null;

  return {
    total,
    page,
    limit,
    totalPages,
    nextPage,
    prevPage,
    ...(randomSeed !== undefined ? { randomSeed } : {}),
  };
}

/**
 * Builds Prisma where conditions for poll filtering
 */
function buildPollFilters(options: {
  published?: boolean;
  guildId: bigint;
  tag?: number;
  user?: PollFilterUser;
  searchQuery?: string;
}) {
  const { published, guildId, tag, user, searchQuery } = options;

  return {
    published,
    guild_id: guildId,
    ...(tag !== undefined ? { tag } : {}),
    ...(user
      ? {
          votes: user.notVoted
            ? { none: { user_id: user.userId } }
            : { some: { user_id: user.userId } },
        }
      : {}),
    ...(searchQuery
      ? {
          OR: [
            {
              question: {
                contains: searchQuery,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              description: {
                contains: searchQuery,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            { choices: { has: searchQuery } },
          ],
        }
      : {}),
  } as any;
}

/**
 * Gets poll IDs that a user has voted on, with optional filtering
 */
async function getUserVotedPollIds(user?: PollFilterUser) {
  if (!user) return null;

  const votedPolls = await prisma.vote.findMany({
    where: { user_id: user.userId },
    select: { poll_id: true },
  });

  const votedIds = votedPolls.map((v) => v.poll_id);

  if (user.notVoted) {
    return votedIds.length > 0
      ? { filter: { id: { notIn: votedIds } }, isEmpty: false }
      : { filter: {}, isEmpty: false };
  }

  return votedIds.length === 0
    ? { isEmpty: true }
    : { filter: { id: { in: votedIds } }, isEmpty: false };
}

/**
 * Determines the sort order direction
 */
function getOrderDirection(orderDir?: OrderDir): "asc" | "desc" {
  return orderDir === OrderDir.Asc ? "asc" : "desc";
}

/**
 * Retrieves polls with filtering, pagination, and sorting options
 */
export async function getPolls({
  guildId,
  published,
  tag,
  ids,
  num,
  active,
  has_start,
  has_end,
  live,
  user,
  search,
  page = 1,
  limit = 10,
  managementOverride = false,
  order = OrderType.Time,
  orderDir,
  seed,
}: PollFilters): Promise<{ data: Poll[]; meta: Meta }> {
  const now = new Date();
  const searchQuery = search ? sanitizeSearchInput(search) : undefined;
  const filters = buildPollFilters({
    published,
    guildId,
    tag,
    user,
    searchQuery,
  });
  const conjuncts = buildPollAuxFilters(
    {
      ids,
      num,
      active,
      has_start,
      has_end,
      live,
    },
    now,
  );
  // Conjunct-array composition: aux filters are AND-appended so no
  // fragment ever writes a top-level OR into the shared filters.
  filters.AND = [...((filters.AND as unknown[]) ?? []), ...conjuncts];

  // Get total count for pagination
  const total = await prisma.poll.count({ where: filters });

  let data: Poll[] = [];
  let randomSeed: number | undefined = undefined;

  if (order === OrderType.Votes || order === OrderType.Random) {
    const result = await handleSpecialOrderingQueries({
      filters,
      user,
      order,
      orderDir,
      page,
      limit,
      guildId,
      published,
      tag,
      searchQuery,
      ids,
      seed,
      now,
    });

    data = result.data;
    randomSeed = result.randomSeed;
  } else {
    // Standard time-based ordering
    data = await handleTimeOrderedQuery({
      filters,
      page,
      limit,
      orderDir,
      now,
    });
  }

  const meta = createPaginationMeta(total, page, limit, randomSeed);
  const processedData = processDataForVisibility(data, managementOverride);

  return { data: processedData, meta };
}

/**
 * Handles vote count and random ordering queries that require special processing
 */
async function handleSpecialOrderingQueries({
  filters,
  user,
  order,
  orderDir,
  page,
  limit,
  guildId,
  published,
  tag,
  searchQuery,
  ids,
  seed,
  now,
}: {
  filters: any;
  user?: PollFilterUser;
  order: OrderType;
  orderDir?: OrderDir;
  page: number;
  limit: number;
  guildId: bigint;
  published?: boolean;
  tag?: number;
  searchQuery?: string;
  ids?: number[];
  seed?: number;
  now: Date;
}): Promise<{ data: Poll[]; randomSeed?: number }> {
  const offset = (page - 1) * limit;

  // Apply user voting filters
  const userFilter = await getUserVotedPollIds(user);
  if (userFilter?.isEmpty) {
    return { data: [] };
  }
  if (userFilter?.filter) {
    Object.assign(filters, userFilter.filter);
  }

  if (order === OrderType.Votes) {
    return await handleVoteOrderedQuery({
      filters,
      limit,
      offset,
      orderDir,
      now,
    });
  } else {
    return await handleRandomOrderedQuery({
      guildId,
      published,
      tag,
      searchQuery,
      ids,
      filters,
      limit,
      offset,
      seed,
      now,
    });
  }
}

/**
 * Handles vote count ordering with database-level count sorting
 */
async function handleVoteOrderedQuery({
  filters,
  limit,
  offset,
  orderDir,
  now,
}: {
  filters: any;
  limit: number;
  offset: number;
  orderDir?: OrderDir;
  now: Date;
}): Promise<{ data: Poll[] }> {
  const polls = await prisma.poll.findMany({
    where: filters,
    take: limit,
    skip: offset,
    orderBy: {
      votes: { _count: getOrderDirection(orderDir) },
    },
    include: {
      votes: {
        select: {
          choice: true,
        },
      },
    },
  });

  return { data: polls.map((poll) => serializePoll(poll, now)) };
}

/**
 * Handles random ordering using database-level randomization
 */
async function handleRandomOrderedQuery({
  guildId,
  published,
  tag,
  searchQuery,
  ids,
  filters,
  limit,
  offset,
  seed,
  now,
}: {
  guildId: bigint;
  published?: boolean;
  tag?: number;
  searchQuery?: string;
  ids?: number[];
  filters: any;
  limit: number;
  offset: number;
  seed?: number;
  now: Date;
}): Promise<{ data: Poll[]; randomSeed: number }> {
  const randomSeed =
    typeof seed === "number"
      ? seed
      : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

  const pollIds: { id: number }[] = await prisma.$queryRaw(
    Prisma.sql`
      SELECT id FROM polls
      WHERE guild_id = ${guildId}
      ${published ? Prisma.sql`AND published = ${published}` : Prisma.empty}
      ${tag !== undefined ? Prisma.sql`AND tag = ${tag}` : Prisma.empty}
      ${
        searchQuery
          ? Prisma.sql`AND (question ILIKE ${`%${searchQuery}%`} OR description ILIKE ${`%${searchQuery}%`} OR EXISTS (SELECT 1 FROM unnest(choices) ch WHERE ch ILIKE ${`%${searchQuery}%`}))`
          : Prisma.empty
      }
      ${
        ids?.length
          ? Prisma.sql`AND id = ANY(${ids})`
          : Prisma.empty
      }
      ${
        filters.id
          ? filters.id.in
            ? Prisma.sql`AND id = ANY(${filters.id.in})`
            : Prisma.sql`AND id NOT IN (${Prisma.join(filters.id.notIn)})`
          : Prisma.empty
      }
      ORDER BY md5(CONCAT(id::text, '-', ${randomSeed}))
      LIMIT ${limit} OFFSET ${offset}
    `
  );

  // Fetch full poll data with votes
  const polls = await prisma.poll.findMany({
    where: {
      id: { in: pollIds.map((p) => p.id) },
    },
    include: {
      votes: {
        select: {
          choice: true,
        },
      },
    },
  });

  // Maintain random order
  const pollMap = new Map(polls.map((poll) => [poll.id, poll]));
  const orderedPolls = pollIds.map(({ id }) => pollMap.get(id)!);

  return {
    data: orderedPolls.map((poll) => serializePoll(poll, now)),
    randomSeed,
  };
}

/**
 * Handles standard time-based ordering
 */
async function handleTimeOrderedQuery({
  filters,
  page,
  limit,
  orderDir,
  now,
}: {
  filters: any;
  page: number;
  limit: number;
  orderDir?: OrderDir;
  now: Date;
}): Promise<Poll[]> {
  const orderBy = { start_time: getOrderDirection(orderDir) };

  return await prisma.poll
    .findMany({
      where: filters,
      take: limit,
      skip: (page - 1) * limit,
      orderBy,
      include: {
        votes: {
          select: {
            choice: true,
          },
        },
      },
    })
    .then((polls) => polls.map((poll) => serializePoll(poll, now)));
}

/**
 * Processes poll data based on management override and vote visibility settings
 */
function processDataForVisibility(
  data: Poll[],
  managementOverride: boolean
): Poll[] {
  if (managementOverride) return data;

  return data.map((poll) => ({
    ...poll,
    votes: poll.show_voting ? poll.votes ?? [] : null,
    // total_votes is already included and remains visible
  }));
}

/**
 * Retrieves a single poll by ID
 */
export async function getPollById(
  id: number,
  managementOverride: boolean = false
): Promise<Poll | null> {
  const poll = await prisma.poll.findUnique({
    where: { id },
    include: {
      votes: {
        select: {
          choice: true,
        },
      },
    },
  });

  if (!poll) return null;

  if (!managementOverride) {
    return { ...serializePoll(poll), votes: null };
  }

  return serializePoll(poll);
}

/**
 * Retrieves multiple polls by their IDs
 */
export async function getPollsFromList(
  pollIds: number[],
  managementOverride: boolean = false
): Promise<Poll[]> {
  const polls = await prisma.poll.findMany({
    where: {
      id: { in: pollIds },
    },
    include: {
      votes: {
        select: {
          choice: true,
        },
      },
    },
  });

  return polls.map((poll) => {
    if (managementOverride) {
      return serializePoll(poll);
    }
    return { ...serializePoll(poll), votes: null };
  });
}
