import { Router } from "express";

import { ApiError } from "@/errors";
import { type GuildIdParams, parseGuildId } from "@/models/paramModels";
import { getGuildById } from "@/services/guildService";

export const botGuildRouter = Router();

botGuildRouter.get("/:id", async (req, res) => {
	const guildId = await parseGuildId({
		guildId: (req.params as GuildIdParams & { id: string }).id,
	});
	const guild = await getGuildById(guildId);
	if (!guild) {
		throw new ApiError(`Guild with id ${guildId} not found`, 404);
	}
	res.status(200).json(guild);
});
