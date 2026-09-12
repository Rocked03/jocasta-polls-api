import { Prisma } from "@/generated/prisma/client";

/**
 * User filtering options for polls
 */
export interface PollFilterUser {
  userId: bigint;
  notVoted?: boolean;
}

/**
 * Builds the derived-active where fragment: published, started, and not
 * ended (open-ended polls count as not ended). One helper, two consumers:
 * the `active` filter and the derived arm of the `live` filter.
 */
function derivedActiveWhere(now: Date): Prisma.PollWhereInput {
  return {
    published: true,
    start_time: { lte: now },
    OR: [{ end_time: null }, { end_time: { gt: now } }],
  };
}

/**
 * Builds the bot-facing aux list filters (ids, num, active, has_start,
 * has_end, live) as an array of conjuncts for AND-appending. Pure — no DB
 * access — so it can be unit tested directly and composed into the list
 * path's filters object. Each conjunct is self-contained: no fragment ever
 * writes a top-level OR into the shared filters.
 */
export function buildPollAuxFilters(
  params: {
    ids?: number[];
    num?: number;
    active?: boolean;
    has_start?: boolean;
    has_end?: boolean;
    live?: boolean;
  },
  now: Date = new Date(),
): Prisma.PollWhereInput[] {
  const conjuncts: Prisma.PollWhereInput[] = [];
  if (params.ids?.length) conjuncts.push({ id: { in: params.ids } });
  if (params.num !== undefined) conjuncts.push({ num: params.num });
  if (params.active === true) conjuncts.push(derivedActiveWhere(now));
  else if (params.active === false)
    conjuncts.push({ NOT: derivedActiveWhere(now) });
  if (params.has_start === true) conjuncts.push({ start_time: { not: null } });
  else if (params.has_start === false) conjuncts.push({ start_time: null });
  if (params.has_end === true) conjuncts.push({ end_time: { not: null } });
  else if (params.has_end === false) conjuncts.push({ end_time: null });
  if (params.live === true) {
    conjuncts.push({
      OR: [derivedActiveWhere(now), { tagRelation: { persistent: true } }],
    });
  }
  return conjuncts;
}
