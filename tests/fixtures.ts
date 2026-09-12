/**
 * Fixture-backed prisma mock for route tests.
 *
 * Exports hand-tunable fixture data plus `createFixturePrisma()`, whose
 * delegates implement exactly the query shapes the services really
 * issue (pollService reads + writes / voteService reads + castVote
 * writes / tagService reads + create/update / guildService reads
 * incl. the manage_channel_id array-contains filter / the lifecycle
 * publish path's tag.update counter bump).
 *
 * Design notes:
 * - Votes live flat in FIXTURE_VOTES; the poll delegates join them onto
 *   polls by poll_id on demand (documented choice: no embedded votes on
 *   poll fixture rows).
 * - Delegates return shallow copies of fixture rows so consumer-side
 *   mutation (e.g. tagService's in-place sort) cannot contaminate other
 *   tests.
 * - This is plain filtering code, not a query engine: any unsupported
 *   where/include/orderBy/select shape THROWS loudly instead of silently
 *   matching everything.
 * - All dates are fixed constants; no Date.now()/Math.random anywhere.
 */

export const FIXTURE_GUILD_ID = 281648235557421056n;
export const FIXTURE_USER_ID = 111111111111111111n;
// The sole role allowed to manage polls per the fixture guild settings;
// the revalidation gate tests intersect mocked member roles against it.
export const FIXTURE_MANAGER_ROLE_ID = 444444444444444444n;
export const FIXTURE_OTHER_USER_ID = 222222222222222222n;
export const FIXTURE_THIRD_USER_ID = 333333333333333333n;

const P1_START = new Date("2024-01-15T12:00:00.000Z");
const P2_START = new Date("2024-02-15T12:00:00.000Z");
const P4_START = new Date("2024-03-15T12:00:00.000Z");
const P3_START = new Date("2030-06-01T12:00:00.000Z"); // far-future constant
const P4_END = new Date("2030-07-01T12:00:00.000Z");
const P5_START = new Date("2023-05-01T12:00:00.000Z");
const P5_END = new Date("2024-05-01T12:00:00.000Z");

export type FixturePoll = {
  id: number;
  question: string;
  published: boolean;
  guild_id: bigint;
  choices: string[];
  start_time: Date | null;
  end_time: Date | null;
  num: number | null;
  message_id: bigint | null;
  crosspost_message_ids: bigint[];
  tag: number;
  image: string | null;
  description: string | null;
  thread_question: string | null;
  show_question: boolean;
  show_options: boolean;
  show_voting: boolean;
  fallback: boolean;
};

export type FixtureVote = {
  id: bigint;
  user_id: bigint;
  poll_id: number;
  choice: number;
};

export type FixtureTag = {
  tag: number;
  name: string;
  guild_id: bigint;
  channel_id: bigint;
  crosspost_channels: bigint[];
  crosspost_servers: bigint[];
  current_num: number | null;
  colour: number | null;
  end_message: string | null;
  end_message_latest_ids: bigint[];
  end_message_replace: boolean;
  end_message_role_ids: bigint[];
  end_message_ping: boolean;
  end_message_self_assign: boolean;
  persistent: boolean;
};

export type FixtureGuildSettings = {
  guild_id: bigint;
  default_channel_id: bigint;
  manage_channel_id: bigint[];
  manager_role_id: bigint[];
  default_colour: number | null;
  fallback_channel_id: bigint | null;
};

// P1: published, visible voting, persistent tag 1, votes 2 -> choice 0, 1 -> choice 1.
//     Started, open-ended (end null) -> derives active.
// P2: published, hidden voting (show_voting false), 2 votes, persistent tag 1
//     (matches both live-filter OR arms: derived-active AND persistent).
//     Started, open-ended -> derives active.
// P3: unpublished, non-persistent tag 2, scheduled (future start_time, end null), no votes -> inactive.
// P4: published, end-scheduled (far-future end_time), non-persistent tag 2, 1 vote -> active.
// P5: published, persistent tag 1, started AND ended in the past -> derived-inactive but live.
// FIXTURE_USER_ID votes on P1 + P2 only, so published/notVoted leaves P4.
export const FIXTURE_POLLS: FixturePoll[] = [
  {
    id: 1,
    question: "P1 published visible voting",
    published: true,
    guild_id: FIXTURE_GUILD_ID,
    choices: ["P1 choice 0", "P1 choice 1"],
    start_time: P1_START,
    end_time: null,
    num: 1,
    message_id: 1001n,
    crosspost_message_ids: [],
    tag: 1,
    image: null,
    description: "P1 description",
    thread_question: null,
    show_question: true,
    show_options: true,
    show_voting: true,
    fallback: false,
  },
  {
    id: 2,
    question: "P2 published hidden voting",
    published: true,
    guild_id: FIXTURE_GUILD_ID,
    choices: ["P2 choice 0", "P2 choice 1"],
    start_time: P2_START,
    end_time: null,
    num: 2,
    message_id: 1002n,
    crosspost_message_ids: [],
    tag: 1,
    image: null,
    description: "P2 description",
    thread_question: null,
    show_question: true,
    show_options: true,
    show_voting: false,
    fallback: false,
  },
  {
    id: 3,
    question: "P3 unpublished scheduled",
    published: false,
    guild_id: FIXTURE_GUILD_ID,
    choices: ["P3 choice 0", "P3 choice 1"],
    start_time: P3_START,
    end_time: null,
    num: null,
    message_id: null,
    crosspost_message_ids: [],
    tag: 2,
    image: null,
    description: null,
    thread_question: null,
    show_question: true,
    show_options: true,
    show_voting: true,
    fallback: false,
  },
  {
    id: 4,
    question: "P4 published end scheduled",
    published: true,
    guild_id: FIXTURE_GUILD_ID,
    choices: ["P4 choice 0", "P4 choice 1"],
    start_time: P4_START,
    end_time: P4_END,
    num: 1,
    message_id: 1004n,
    crosspost_message_ids: [],
    tag: 2,
    image: null,
    description: null,
    thread_question: null,
    show_question: true,
    show_options: true,
    show_voting: true,
    fallback: false,
  },
  {
    id: 5,
    question: "P5 published ended persistent",
    published: true,
    guild_id: FIXTURE_GUILD_ID,
    choices: ["P5 choice 0", "P5 choice 1"],
    start_time: P5_START,
    end_time: P5_END,
    num: 3,
    message_id: 1005n,
    crosspost_message_ids: [],
    tag: 1,
    image: null,
    description: null,
    thread_question: null,
    show_question: true,
    show_options: true,
    show_voting: true,
    fallback: false,
  },
];

export const FIXTURE_VOTES: FixtureVote[] = [
  { id: 1n, user_id: FIXTURE_USER_ID, poll_id: 1, choice: 0 },
  { id: 2n, user_id: FIXTURE_OTHER_USER_ID, poll_id: 1, choice: 0 },
  { id: 3n, user_id: FIXTURE_THIRD_USER_ID, poll_id: 1, choice: 1 },
  { id: 4n, user_id: FIXTURE_USER_ID, poll_id: 2, choice: 1 },
  { id: 5n, user_id: FIXTURE_OTHER_USER_ID, poll_id: 2, choice: 0 },
  { id: 6n, user_id: FIXTURE_THIRD_USER_ID, poll_id: 4, choice: 0 },
];

// T1: persistent, both end-message flags set. T2: non-persistent, neither.
export const FIXTURE_TAGS: FixtureTag[] = [
  {
    tag: 1,
    name: "T1 persistent tag",
    guild_id: FIXTURE_GUILD_ID,
    channel_id: 101n,
    crosspost_channels: [],
    crosspost_servers: [],
    current_num: 1,
    colour: null,
    end_message: null,
    end_message_latest_ids: [],
    end_message_replace: true,
    end_message_role_ids: [],
    end_message_ping: false,
    end_message_self_assign: true,
    persistent: true,
  },
  {
    tag: 2,
    name: "T2 non-persistent tag",
    guild_id: FIXTURE_GUILD_ID,
    channel_id: 102n,
    crosspost_channels: [],
    crosspost_servers: [],
    current_num: 1,
    colour: null,
    end_message: null,
    end_message_latest_ids: [],
    end_message_replace: false,
    end_message_role_ids: [],
    end_message_ping: false,
    end_message_self_assign: false,
    persistent: false,
  },
];

export const FIXTURE_MANAGE_CHANNEL_A = 555000000000000001n;
export const FIXTURE_MANAGE_CHANNEL_B = 555000000000000002n;
export const FIXTURE_OTHER_GUILD_ID = 999999999999999999n;

export const FIXTURE_GUILD_SETTINGS: FixtureGuildSettings[] = [
  {
    guild_id: FIXTURE_GUILD_ID,
    default_channel_id: 101n,
    manage_channel_id: [FIXTURE_MANAGE_CHANNEL_A],
    manager_role_id: [FIXTURE_MANAGER_ROLE_ID],
    default_colour: null,
    fallback_channel_id: null,
  },
  {
    guild_id: FIXTURE_OTHER_GUILD_ID,
    default_channel_id: 201n,
    manage_channel_id: [FIXTURE_MANAGE_CHANNEL_B],
    manager_role_id: [],
    default_colour: null,
    fallback_channel_id: null,
  },
];

// ===== mock engine =====

type Row = Record<string, unknown>;
type MockArgs = {
  where?: unknown;
  include?: unknown;
  select?: unknown;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  by?: unknown;
  _count?: unknown;
  data?: unknown;
};

function unsupported(what: string, value: unknown): never {
  const printable = JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  throw new Error(`fixture prisma mock: unsupported ${what}: ${printable}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  record: Record<string, unknown>,
  keys: string[],
): boolean {
  const present = Object.keys(record);
  return (
    present.length === keys.length && keys.every((key) => present.includes(key))
  );
}

function dirOf(value: unknown): "asc" | "desc" {
  if (value === "asc" || value === "desc") return value;
  return unsupported("order direction", value);
}

function toMillis(date: Date | null): number {
  return date ? date.getTime() : 0;
}

function cmpNum(a: number, b: number, dir: "asc" | "desc"): number {
  return dir === "asc" ? a - b : b - a;
}

function votesFor(pollId: number): FixtureVote[] {
  return FIXTURE_VOTES.filter((vote) => vote.poll_id === pollId);
}

function matchIdFilter(id: number, cond: unknown): boolean {
  if (isRecord(cond) && Array.isArray(cond.in)) return cond.in.includes(id);
  if (isRecord(cond) && Array.isArray(cond.notIn)) return !cond.notIn.includes(id);
  return unsupported("poll where id", cond);
}

function matchNullableFilter(
  value: Date | null,
  cond: unknown,
  what: string,
): boolean {
  if (cond === null) return value === null;
  if (isRecord(cond) && hasExactKeys(cond, ["not"]) && cond.not === null) {
    return value !== null;
  }
  if (
    isRecord(cond) &&
    hasExactKeys(cond, ["lte"]) &&
    cond.lte instanceof Date
  ) {
    // SQL semantics: a NULL timestamp fails every comparison.
    return value !== null && value.getTime() <= cond.lte.getTime();
  }
  if (isRecord(cond) && hasExactKeys(cond, ["gt"]) && cond.gt instanceof Date) {
    return value !== null && value.getTime() > cond.gt.getTime();
  }
  return unsupported(what, cond);
}

function matchVotesRelation(votes: FixtureVote[], cond: unknown): boolean {
  if (isRecord(cond)) {
    const some = cond.some;
    if (isRecord(some) && hasExactKeys(some, ["user_id"])) {
      return votes.some((vote) => vote.user_id === some.user_id);
    }
    const none = cond.none;
    if (isRecord(none) && hasExactKeys(none, ["user_id"])) {
      return votes.every((vote) => vote.user_id !== none.user_id);
    }
  }
  return unsupported("poll where votes", cond);
}

function matchTagRelation(poll: FixturePoll, cond: unknown): boolean {
  const persistent = isRecord(cond) ? cond.persistent : undefined;
  if (persistent !== true) return unsupported("poll where tagRelation", cond);
  const tagRow = FIXTURE_TAGS.find((tag) => tag.tag === poll.tag);
  return tagRow !== undefined && tagRow.persistent;
}

function matchContains(value: string, cond: unknown, what: string): boolean {
  const contains = isRecord(cond) ? cond.contains : undefined;
  if (typeof contains !== "string") return unsupported(what, cond);
  const mode = isRecord(cond) ? cond.mode : undefined;
  if (mode !== undefined && mode !== "insensitive") {
    return unsupported(`${what} mode`, mode);
  }
  const hay = mode === "insensitive" ? value.toLowerCase() : value;
  const needle = mode === "insensitive" ? contains.toLowerCase() : contains;
  return hay.includes(needle);
}

function matchChoicesHas(choices: string[], cond: unknown): boolean {
  const has = isRecord(cond) ? cond.has : undefined;
  if (typeof has !== "string") return unsupported("poll where choices", cond);
  return choices.includes(has);
}

function matchPoll(poll: FixturePoll, where: unknown): boolean {
  // Runtime enforcement of the post-2_finalize_schema invariant: `tag` is
  // NOT NULL in production, so a null-tag fixture row is an unsupported
  // shape even though the FixturePoll type already forbids it.
  const tag: number | null = poll.tag;
  if (tag === null) return unsupported("poll tag (NOT NULL)", tag);
  if (where === undefined) return true;
  if (!isRecord(where)) return unsupported("poll where", where);
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue; // e.g. `published: undefined` from builders
    let ok: boolean;
    switch (key) {
      case "id":
        ok = matchIdFilter(poll.id, cond);
        break;
      case "guild_id":
      case "published":
      case "tag":
      case "num":
        ok = poll[key] === cond;
        break;
      case "start_time":
      case "end_time":
        ok = matchNullableFilter(poll[key], cond, `poll where ${key}`);
        break;
      case "votes":
        ok = matchVotesRelation(votesFor(poll.id), cond);
        break;
      case "tagRelation":
        ok = matchTagRelation(poll, cond);
        break;
      case "question":
      case "description":
        ok = matchContains(poll[key] ?? "", cond, `poll where ${key}`);
        break;
      case "choices":
        ok = matchChoicesHas(poll.choices, cond);
        break;
      case "OR":
        ok = Array.isArray(cond) && cond.some((sub) => matchPoll(poll, sub));
        break;
      case "AND":
        ok = Array.isArray(cond) && cond.every((sub) => matchPoll(poll, sub));
        break;
      case "NOT":
        if (!isRecord(cond)) return unsupported("poll where NOT", cond);
        ok = !matchPoll(poll, cond);
        break;
      default:
        return unsupported(`poll where ${key}`, cond);
    }
    if (!ok) return false;
  }
  return true;
}

function matchVote(vote: FixtureVote, where: unknown): boolean {
  if (where === undefined) return true;
  if (!isRecord(where)) return unsupported("vote where", where);
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    let ok: boolean;
    switch (key) {
      case "poll_id":
      case "user_id":
        ok = vote[key] === cond;
        break;
      default:
        return unsupported(`vote where ${key}`, cond);
    }
    if (!ok) return false;
  }
  return true;
}

function pickSelect(row: Row, select: unknown): Row {
  if (!isRecord(select)) return unsupported("select", select);
  const out: Row = {};
  for (const key of Object.keys(select)) {
    if (select[key] !== true || !(key in row)) {
      return unsupported("select", select);
    }
    out[key] = row[key];
  }
  return out;
}

function shapePollRow(poll: FixturePoll, include: unknown, select: unknown): Row {
  const row: Row = { ...poll };
  if (select !== undefined) {
    return pickSelect(row, select);
  }
  if (include !== undefined) {
    const votesInclude = isRecord(include) ? include.votes : undefined;
    const voteSelect = isRecord(votesInclude) ? votesInclude.select : undefined;
    if (
      !isRecord(votesInclude) ||
      !hasExactKeys(votesInclude, ["select"]) ||
      !isRecord(voteSelect) ||
      !hasExactKeys(voteSelect, ["choice"]) ||
      voteSelect.choice !== true
    ) {
      return unsupported("poll include", include);
    }
    row.votes = votesFor(poll.id).map((vote) => ({ choice: vote.choice }));
  }
  return row;
}

function sortPolls(rows: FixturePoll[], orderBy: unknown): FixturePoll[] {
  const sorted = [...rows];
  if (isRecord(orderBy) && hasExactKeys(orderBy, ["start_time"])) {
    const dir = dirOf(orderBy.start_time);
    sorted.sort((a, b) => cmpNum(toMillis(a.start_time), toMillis(b.start_time), dir));
  } else {
    const votesOrder = isRecord(orderBy) ? orderBy.votes : undefined;
    const countDir = isRecord(votesOrder) ? votesOrder._count : undefined;
    if (countDir === undefined) return unsupported("poll orderBy", orderBy);
    const dir = dirOf(countDir);
    sorted.sort((a, b) => cmpNum(votesFor(a.id).length, votesFor(b.id).length, dir));
  }
  return sorted;
}

// ===== delegates =====
//
// All delegates are async: pollService chains .then() directly on
// prisma.poll.findMany(...) (no await), so synchronous returns are not
// thenable enough.

async function pollFindMany(args: MockArgs = {}): Promise<Row[]> {
  let rows = FIXTURE_POLLS.filter((poll) => matchPoll(poll, args.where));
  if (args.orderBy !== undefined) {
    rows = sortPolls(rows, args.orderBy);
  }
  const skip = args.skip ?? 0;
  const take = args.take;
  rows = take !== undefined ? rows.slice(skip, skip + take) : rows.slice(skip);
  return rows.map((poll) => shapePollRow(poll, args.include, args.select));
}

async function pollFindUnique(args: MockArgs): Promise<Row | null> {
  const where = args.where;
  const id = isRecord(where) && hasExactKeys(where, ["id"]) ? where.id : undefined;
  if (id === undefined) return unsupported("poll.findUnique where", where);
  const poll = FIXTURE_POLLS.find((poll) => poll.id === id);
  return poll === undefined ? null : shapePollRow(poll, args.include, args.select);
}

async function pollCount(args: MockArgs = {}): Promise<number> {
  return FIXTURE_POLLS.filter((poll) => matchPoll(poll, args.where)).length;
}

const POLL_FIELD_NAMES = new Set([
  "id",
  "question",
  "published",
  "guild_id",
  "choices",
  "start_time",
  "end_time",
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
]);

async function pollCreate(args: MockArgs): Promise<Row> {
  const data = args.data;
  if (
    !isRecord(data) ||
    !hasExactKeys(data, [...POLL_FIELD_NAMES]) ||
    typeof data.id !== "number" ||
    typeof data.question !== "string" ||
    typeof data.guild_id !== "bigint" ||
    !Array.isArray(data.choices) ||
    typeof data.tag !== "number"
  ) {
    return unsupported("poll.create data", data);
  }
  if (FIXTURE_POLLS.some((poll) => poll.id === data.id)) {
    // Real prisma enforces the PK; mirror it so id collisions fail
    // loudly instead of double-creating.
    throw new Error(
      `fixture prisma mock: poll.create duplicate id ${data.id} (PK)`,
    );
  }
  const row = { ...data } as FixturePoll;
  FIXTURE_POLLS.push(row);
  return shapePollRow(row, args.include, args.select);
}

async function pollUpdate(args: MockArgs): Promise<Row> {
  const where = args.where;
  const data = args.data;
  const id =
    isRecord(where) && hasExactKeys(where, ["id"]) ? where.id : undefined;
  if (id === undefined || !isRecord(data)) {
    return unsupported("poll.update args", { where, data });
  }
  const poll = FIXTURE_POLLS.find((poll) => poll.id === id);
  if (poll === undefined) {
    throw new Error(`fixture prisma mock: poll.update unknown id ${id}`);
  }
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue; // prisma skips undefined fields
    if (!POLL_FIELD_NAMES.has(key)) {
      return unsupported("poll.update data key", { key, value });
    }
    (poll as unknown as Record<string, unknown>)[key] = value;
  }
  return shapePollRow(poll, args.include, args.select);
}

/**
 * Models the FK cascade: deleting polls removes their votes. Only the
 * id-in shape the write services issue is supported.
 */
async function pollDeleteMany(args: MockArgs): Promise<{ count: number }> {
  const where = args.where;
  const cond =
    isRecord(where) && hasExactKeys(where, ["id"]) ? where.id : undefined;
  const ids = isRecord(cond) && Array.isArray(cond.in) ? cond.in : undefined;
  if (ids === undefined || !ids.every((id) => typeof id === "number")) {
    return unsupported("poll.deleteMany where", where);
  }
  const doomed = FIXTURE_POLLS.filter((poll) => ids.includes(poll.id));
  for (const poll of doomed) {
    FIXTURE_POLLS.splice(FIXTURE_POLLS.indexOf(poll), 1);
  }
  const doomedVotes = FIXTURE_VOTES.filter((vote) =>
    ids.includes(vote.poll_id),
  );
  for (const vote of doomedVotes) {
    FIXTURE_VOTES.splice(FIXTURE_VOTES.indexOf(vote), 1);
  }
  return { count: doomed.length };
}

async function voteGroupBy(
  args: MockArgs,
): Promise<Array<{ choice: number; _count: { choice: number } }>> {
  const where = args.where;
  const pollId = isRecord(where) ? where.poll_id : undefined;
  if (
    !Array.isArray(args.by) ||
    args.by.length !== 1 ||
    args.by[0] !== "choice" ||
    !isRecord(args._count) ||
    !hasExactKeys(args._count, ["choice"]) ||
    args._count.choice !== true ||
    !isRecord(where) ||
    !hasExactKeys(where, ["poll_id"]) ||
    typeof pollId !== "number"
  ) {
    return unsupported("vote.groupBy args", {
      by: args.by,
      _count: args._count,
      where,
    });
  }
  const counts = new Map<number, number>();
  for (const vote of votesFor(pollId)) {
    counts.set(vote.choice, (counts.get(vote.choice) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([choice, count]) => ({ choice, _count: { choice: count } }));
}

async function voteFindFirst(args: MockArgs): Promise<Row | null> {
  const vote = FIXTURE_VOTES.find((vote) => matchVote(vote, args.where));
  return vote === undefined ? null : { ...vote };
}

async function voteFindMany(args: MockArgs = {}): Promise<Row[]> {
  return FIXTURE_VOTES.filter((vote) => matchVote(vote, args.where)).map(
    (vote) =>
      args.select !== undefined ? pickSelect({ ...vote }, args.select) : { ...vote },
  );
}

async function voteCreate(args: MockArgs): Promise<Row> {
  const data = args.data;
  if (
    !isRecord(data) ||
    !hasExactKeys(data, ["id", "user_id", "poll_id", "choice"]) ||
    typeof data.id !== "bigint" ||
    typeof data.user_id !== "bigint" ||
    typeof data.poll_id !== "number" ||
    typeof data.choice !== "number"
  ) {
    return unsupported("vote.create data", data);
  }
  if (FIXTURE_VOTES.some((vote) => vote.id === data.id)) {
    // Real prisma enforces the PK; mirror it so id-scheme collisions
    // fail loudly instead of silently double-counting.
    throw new Error(
      `fixture prisma mock: vote.create duplicate id ${data.id} (PK)`,
    );
  }
  const row: FixtureVote = {
    id: data.id,
    user_id: data.user_id,
    poll_id: data.poll_id,
    choice: data.choice,
  };
  FIXTURE_VOTES.push(row);
  return { ...row };
}

async function voteUpdate(args: MockArgs): Promise<Row> {
  const where = args.where;
  const data = args.data;
  const id =
    isRecord(where) && hasExactKeys(where, ["id"]) ? where.id : undefined;
  if (
    id === undefined ||
    !isRecord(data) ||
    !hasExactKeys(data, ["choice"]) ||
    typeof data.choice !== "number"
  ) {
    return unsupported("vote.update args", { where, data });
  }
  const vote = FIXTURE_VOTES.find((vote) => vote.id === id);
  if (vote === undefined) {
    throw new Error(`fixture prisma mock: vote.update unknown id ${id}`);
  }
  vote.choice = data.choice;
  return { ...vote };
}

async function voteDeleteMany(args: MockArgs): Promise<{ count: number }> {
  const where = args.where;
  if (!isRecord(where) || !hasExactKeys(where, ["user_id", "poll_id"])) {
    return unsupported("vote.deleteMany where", where);
  }
  const doomed = FIXTURE_VOTES.filter((vote) => matchVote(vote, where));
  for (const vote of doomed) {
    FIXTURE_VOTES.splice(FIXTURE_VOTES.indexOf(vote), 1);
  }
  return { count: doomed.length };
}

function matchTag(tag: FixtureTag, where: unknown): boolean {
  if (where === undefined) return true;
  if (!isRecord(where)) return unsupported("tag where", where);
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue; // e.g. omitted filter options
    let ok: boolean;
    switch (key) {
      case "end_message_self_assign":
      case "end_message_replace":
        ok = tag[key] === cond;
        break;
      default:
        return unsupported(`tag where ${key}`, cond);
    }
    if (!ok) return false;
  }
  return true;
}

async function tagFindMany(args: MockArgs = {}): Promise<Row[]> {
  const rows = FIXTURE_TAGS.filter((tag) => matchTag(tag, args.where));
  const include = args.include;
  if (include === undefined) {
    return rows.map((tag) => ({ ...tag }));
  }
  // tagService.getTags: include: { polls: { where, orderBy, take } }
  const pollsInclude = isRecord(include) ? include.polls : undefined;
  const pollsWhere = isRecord(pollsInclude) ? pollsInclude.where : undefined;
  const pollsOrderBy = isRecord(pollsInclude) ? pollsInclude.orderBy : undefined;
  const take = isRecord(pollsInclude) ? pollsInclude.take : undefined;
  const whereOk =
    isRecord(pollsWhere) &&
    Object.keys(pollsWhere).every((key) => key === "published");
  const orderOk = isRecord(pollsOrderBy) && hasExactKeys(pollsOrderBy, ["start_time"]);
  if (
    !isRecord(pollsInclude) ||
    !whereOk ||
    !orderOk ||
    (take !== undefined && typeof take !== "number")
  ) {
    return unsupported("tag.findMany include", include);
  }
  const dir = dirOf(pollsOrderBy.start_time);
  return rows.map((tag) => {
    const polls = FIXTURE_POLLS.filter(
      (poll) => poll.tag === tag.tag && matchPoll(poll, pollsWhere),
    )
      .sort((a, b) => cmpNum(toMillis(a.start_time), toMillis(b.start_time), dir))
      .slice(0, take)
      .map((poll) => ({ ...poll }));
    return { ...tag, polls };
  });
}

async function tagFindUnique(args: MockArgs): Promise<Row | null> {
  const where = args.where;
  const tagId = isRecord(where) && hasExactKeys(where, ["tag"]) ? where.tag : undefined;
  if (tagId === undefined) return unsupported("tag.findUnique where", where);
  const tag = FIXTURE_TAGS.find((tag) => tag.tag === tagId);
  return tag === undefined ? null : { ...tag };
}

async function tagFindFirst(args: MockArgs): Promise<Row | null> {
  const where = args.where;
  const guildId = isRecord(where) ? where.guild_id : undefined;
  const name = isRecord(where) ? where.name : undefined;
  if (typeof guildId !== "bigint" || typeof name !== "string") {
    return unsupported("tag.findFirst where", where);
  }
  const tag = FIXTURE_TAGS.find(
    (tag) => tag.guild_id === guildId && tag.name === name,
  );
  return tag === undefined ? null : { ...tag };
}

const TAG_FIELD_NAMES = new Set([
  "tag",
  "name",
  "guild_id",
  "channel_id",
  "crosspost_channels",
  "crosspost_servers",
  "current_num",
  "colour",
  "end_message",
  "end_message_latest_ids",
  "end_message_replace",
  "end_message_role_ids",
  "end_message_ping",
  "end_message_self_assign",
  "persistent",
]);

/**
 * tag.update for the lifecycle publish path's atomic counter bump:
 * supports plain values and the `{ increment: n }` atomic shape (the
 * only atomic op the services issue). Mutates FIXTURE_TAGS in place
 * like the other write delegates.
 */
async function tagUpdate(args: MockArgs): Promise<Row> {
  const where = args.where;
  const data = args.data;
  const tagId = isRecord(where) && hasExactKeys(where, ["tag"]) ? where.tag : undefined;
  if (tagId === undefined || !isRecord(data)) {
    return unsupported("tag.update args", { where, data });
  }
  const tag = FIXTURE_TAGS.find((tag) => tag.tag === tagId);
  if (tag === undefined) {
    throw new Error(`fixture prisma mock: tag.update unknown id ${tagId}`);
  }
  const row = tag as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue; // prisma skips undefined fields
    if (!TAG_FIELD_NAMES.has(key)) {
      return unsupported("tag.update data key", { key, value });
    }
    if (isRecord(value) && hasExactKeys(value, ["increment"])) {
      const current = row[key];
      if (
        typeof value.increment !== "number" ||
        typeof current !== "number"
      ) {
        // matches SQL: NULL + n stays NULL — unsupported in fixtures
        return unsupported("tag.update increment", { key, value });
      }
      row[key] = current + value.increment;
    } else {
      row[key] = value;
    }
  }
  return { ...tag };
}

async function tagCreate(args: MockArgs): Promise<Row> {
  const data = args.data;
  if (
    !isRecord(data) ||
    !hasExactKeys(data, [...TAG_FIELD_NAMES]) ||
    typeof data.tag !== "number" ||
    typeof data.name !== "string" ||
    typeof data.guild_id !== "bigint" ||
    typeof data.channel_id !== "bigint"
  ) {
    return unsupported("tag.create data", data);
  }
  if (FIXTURE_TAGS.some((tag) => tag.tag === data.tag)) {
    // Real prisma enforces the PK; mirror it so id collisions fail loudly.
    throw new Error(
      `fixture prisma mock: tag.create duplicate id ${data.tag} (PK)`,
    );
  }
  const row = { ...data } as FixtureTag;
  FIXTURE_TAGS.push(row);
  return { ...row };
}

function matchGuild(guild: FixtureGuildSettings, where: unknown): boolean {
  if (where === undefined) return true;
  if (!isRecord(where)) return unsupported("guildSettings where", where);
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue; // e.g. omitted filter options
    if (key !== "manage_channel_id") {
      return unsupported(`guildSettings where ${key}`, cond);
    }
    const has = isRecord(cond) ? cond.has : undefined;
    if (typeof has !== "bigint") {
      return unsupported("guildSettings where manage_channel_id", cond);
    }
    if (!guild.manage_channel_id.includes(has)) return false;
  }
  return true;
}

async function guildSettingsFindMany(args: MockArgs = {}): Promise<Row[]> {
  return FIXTURE_GUILD_SETTINGS.filter((guild) =>
    matchGuild(guild, args.where),
  ).map((guild) => ({ ...guild }));
}

async function guildSettingsFindUnique(args: MockArgs): Promise<Row | null> {
  const where = args.where;
  const guildId =
    isRecord(where) && hasExactKeys(where, ["guild_id"]) ? where.guild_id : undefined;
  if (guildId === undefined) {
    return unsupported("guildSettings.findUnique where", where);
  }
  const guild = FIXTURE_GUILD_SETTINGS.find((guild) => guild.guild_id === guildId);
  return guild === undefined ? null : { ...guild };
}

/**
 * Builds the fixture-backed prisma delegate set. Reads plus the write
 * paths the services issue (voteService.castVote writes, the poll write
 * services' create/update/deleteMany — poll.deleteMany CASCADEs votes
 * like the production FK); everything else — other writes, `$queryRaw`
 * (order=random) — fails loudly if a test reaches it. Write delegates
 * mutate FIXTURE_POLLS / FIXTURE_VOTES in place, so tests that write
 * should restore them (see castVote.test.ts / writeServices.test.ts).
 */
export function createFixturePrisma() {
  return {
    $connect: async () => {},
    $disconnect: async () => {},
    poll: {
      findMany: pollFindMany,
      findUnique: pollFindUnique,
      count: pollCount,
      create: pollCreate,
      update: pollUpdate,
      deleteMany: pollDeleteMany,
    },
    vote: {
      groupBy: voteGroupBy,
      findFirst: voteFindFirst,
      findMany: voteFindMany,
      create: voteCreate,
      update: voteUpdate,
      deleteMany: voteDeleteMany,
    },
    tag: {
      findMany: tagFindMany,
      findUnique: tagFindUnique,
      findFirst: tagFindFirst,
      create: tagCreate,
      update: tagUpdate,
    },
    guildSettings: {
      findMany: guildSettingsFindMany,
      findUnique: guildSettingsFindUnique,
    },
  };
}
