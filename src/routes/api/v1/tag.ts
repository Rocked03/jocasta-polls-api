import { ApiError } from "@/errors";
import {
  type TagFilterParams,
  type TagIdParams,
  parseTagFilterParams,
  parseTagId,
  parseUpdateTagBody,
} from "@/models/paramModels";
import {
  createTag,
  getTagById,
  getTags,
  updateTag,
} from "@/services/tagService";
import { attachManagementPermsFlag } from "@/utils/checkDiscordMembership";
import { requireManagementPerms } from "@/middleware/requireAuth";
import { Router } from "express";

export const tagRouter = Router();

tagRouter.get("/", async (req, res) => {
  try {
    const filters = await parseTagFilterParams(
      req.query as unknown as TagFilterParams
    );
    const hasManagementPerms = await attachManagementPermsFlag(req);
    const tags = await getTags({
      ...filters,
      publishedOnly: !hasManagementPerms,
    });
    res.status(200).json(tags);
  } catch (error) {
    ApiError.sendError(res, error);
  }
});

tagRouter.get("/:tagId", async (req, res) => {
  try {
    const tagId = await parseTagId(req.params as unknown as TagIdParams);
    const tag = await getTagById(tagId);
    if (!tag) {
      throw new ApiError(`Tag with id ${tagId} not found`, 404);
    }
    res.status(200).json(tag);
  } catch (error) {
    ApiError.sendError(res, error);
  }
});

tagRouter.post("/create", requireManagementPerms, async (req, res) => {
  try {
    const createdTag = await createTag(req.body);
    res.status(201).json(createdTag);
  } catch (error) {
    ApiError.sendError(res, error);
  }
});

tagRouter.post("/update", requireManagementPerms, async (req, res) => {
  try {
    const { tag, ...fields } = parseUpdateTagBody(req.body);
    const updatedTag = await updateTag(tag, fields);
    res.status(200).json(updatedTag);
  } catch (error) {
    ApiError.sendError(res, error);
  }
});
