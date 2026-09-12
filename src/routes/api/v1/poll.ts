import { ApiError, NotFoundError } from "@/errors";
import { requireAuth, requireManagementPerms } from "@/middleware/requireAuth";
import {
  parseGuildId,
  parsePollFilterParams,
  parsePollId,
  parseUserId,
  parseChoice,
  type PollIdParams,
  type UserIdParams,
  type VoteParams,
} from "@/models/paramModels";
import { getPollById, getPolls } from "@/services/pollReadService";
import { serializePoll } from "@/services/pollSerializer";
import { createPolls, deletePolls, updatePolls } from "@/services/pollWriteService";
import {
  castVote,
  getVote,
  getVotesByPoll,
  getVotesByUser,
} from "@/services/voteService";
import { attachManagementPermsFlag } from "@/utils/checkDiscordMembership";
import { Router } from "express";

export const pollRouter = Router();

pollRouter.get("/", async (req, res) => {
  const guildId = await parseGuildId(req.query);
  const {
    published,
    tag,
    userId,
    notVoted,
    search,
    ids,
    num,
    active,
    has_start,
    has_end,
    live,
    page,
    limit,
    order,
    orderDir,
    seed,
  } = await parsePollFilterParams(req.query);

  let hasManagementPerms = false;

  if (published === false) {
    hasManagementPerms = await attachManagementPermsFlag(req);
    if (!hasManagementPerms) {
      throw new ApiError("You cannot view unpublished polls", 403);
    }
  }

  const { data, meta } = await getPolls({
    guildId: guildId,
    published: hasManagementPerms ? published : true,
    tag,
    ids,
    num,
    active,
    has_start,
    has_end,
    live,
    user: userId
      ? {
          userId: userId,
          notVoted: notVoted,
        }
      : undefined,
    search,
    page,
    limit,
    order,
    orderDir,
    seed,
    managementOverride: hasManagementPerms,
  });

  const query = { ...req.query };

  const makePageUrl = (pageNum: number | null) =>
    pageNum
      ? `${req.protocol}://${req.get("host")}${
          req.path
        }?${new URLSearchParams({
          ...query,
          page: pageNum.toString(),
          ...(order ? { order } : {}),
          ...(orderDir ? { orderDir } : {}),
          ...(meta.randomSeed !== undefined
            ? { seed: meta.randomSeed.toString() }
            : {}),
        }).toString()}`
      : undefined;

  meta.nextPageUrl = makePageUrl(meta.nextPage);
  meta.prevPageUrl = makePageUrl(meta.prevPage);

  res.status(200).json({
    data,
    meta,
  });
});

pollRouter.get("/:pollId", async (req, res) => {
  const pollId = await parsePollId(req.params as PollIdParams);

  const hasManagementPerms = await attachManagementPermsFlag(req);
  const poll = await getPollById(pollId, hasManagementPerms);

  if (!poll || (poll.published === false && !hasManagementPerms)) {
    throw new NotFoundError(`Poll with id ${pollId} not found`);
  }
  res.status(200).json(poll);
});

pollRouter.get("/:pollId/votes", async (req, res) => {
  const pollId = await parsePollId(req.params as PollIdParams);
  const hasManagementPerms = await attachManagementPermsFlag(req);
  const votes = await getVotesByPoll(pollId, hasManagementPerms);
  res.status(200).json(votes);
});

pollRouter.get("/:pollId/votes/:userId", async (req, res) => {
  const pollId = await parsePollId(req.params as PollIdParams);
  const userId = await parseUserId(req.params as UserIdParams);
  const vote = await getVote(pollId, userId);
  if (!vote) {
    throw new NotFoundError(`Vote not found for user ${userId}`);
  }
  res.status(200).json(vote);
});

pollRouter.post("/:pollId/vote", requireAuth, async (req, res) => {
  const pollId = await parsePollId(req.params);
  const userId = await parseUserId(req.body as UserIdParams);
  const choice = await parseChoice(req.body as VoteParams);

  const { deleted } = await castVote(pollId, userId, choice);

  if (choice === null || choice === undefined) {
    res.status(200).json({
      message: deleted ? "Vote deleted successfully" : "No vote to delete",
    });
    return;
  }

  res.status(200).json({ message: "Vote cast successfully" });
});

pollRouter.get("/votes/:userId", async (req, res) => {
  const userId = await parseUserId(req.params as UserIdParams);
  const votes = await getVotesByUser(userId);
  res.status(200).json(votes);
});

pollRouter.post("/create", requireManagementPerms, async (req, res) => {
  const createdPolls = await createPolls(req.body);

  res.status(201).json({
    message: "Polls created successfully",
    polls: createdPolls.map((poll) => serializePoll(poll)),
  });
});

pollRouter.post("/update", requireManagementPerms, async (req, res) => {
  const updatedPolls = await updatePolls(req.body);

  res.status(200).json({
    message: "Polls updated successfully",
    polls: updatedPolls.map((poll) => serializePoll(poll)),
  });
});

pollRouter.post("/delete", requireManagementPerms, async (req, res) => {
  const deletedPolls = await deletePolls(req.body.pollIds);

  res.status(200).json({
    message: "Polls deleted successfully",
    deletedCount: deletedPolls.count,
  });
});
