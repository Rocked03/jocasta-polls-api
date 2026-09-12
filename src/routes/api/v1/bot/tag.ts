import { Router } from "express";

import { ApiError } from "@/errors";
import { requireDiscordRevalidation } from "@/middleware/requireDiscordRevalidation";
import {
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

export const botTagRouter = Router();

botTagRouter.get("/", async (req, res) => {
	const filters = await parseTagFilterParams(
		req.query,
	);
	const tags = await getTags(filters);
	res.status(200).json(tags);
});

botTagRouter.get("/:id", async (req, res) => {
	const tagId = await parseTagId(req.params);
	const tag = await getTagById(tagId);
	if (!tag) {
		throw new ApiError(`Tag with id ${tagId} not found`, 404);
	}
	res.status(200).json(tag);
});

botTagRouter.post("/create", requireDiscordRevalidation, async (req, res) => {
	const createdTag = await createTag(req.body);
	res.status(201).json(createdTag);
});

botTagRouter.post("/update", requireDiscordRevalidation, async (req, res) => {
	const { tag, ...fields } = parseUpdateTagBody(req.body);
	const updatedTag = await updateTag(tag, fields);
	res.status(200).json(updatedTag);
});
