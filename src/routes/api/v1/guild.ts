import { ApiError } from "@/errors";
import {
	type GuildFilterParams,
	type GuildIdParams,
	parseGuildFilterParams,
	parseGuildId,
} from "@/models/paramModels";
import { getGuildById, getGuilds } from "@/services/guildService";
import { Router } from "express";

export const guildRouter = Router();

guildRouter.get("/", async (req, res) => {
	try {
		const { manage_channel_id } = await parseGuildFilterParams(
			req.query,
		);
		const guilds = await getGuilds({ manage_channel_id });
		res.status(200).json(guilds);
	} catch (error) {
		ApiError.sendError(res, error);
	}
});
guildRouter.get("/:guildId", async (req, res) => {
	try {
		const guildId = await parseGuildId(req.params);
		const guild = await getGuildById(guildId);
		if (!guild) {
			throw new ApiError(`Guild with id ${guildId} not found`, 404);
		}
		res.status(200).json(guild);
	} catch (error) {
		ApiError.sendError(res, error);
	}
});
