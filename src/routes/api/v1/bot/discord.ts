import { Router } from "express";

import config from "@/config";
import { ApiError } from "@/errors";
import { parseGuildId } from "@/models/paramModels";
import {
	fetchGuildChannels,
	fetchGuildRoles,
} from "@/services/discordService";

export const botDiscordRouter = Router();

botDiscordRouter.get("/guilds/:id/channels", async (req, res) => {
	const guildId = await parseGuildId({ guildId: req.params.id });
	if (guildId !== config.guildId) {
		throw new ApiError("Guild not supported", 403);
	}
	const channels = await fetchGuildChannels(guildId.toString());
	res.status(200).json(channels);
});

botDiscordRouter.get("/guilds/:id/roles", async (req, res) => {
	const guildId = await parseGuildId({ guildId: req.params.id });
	if (guildId !== config.guildId) {
		throw new ApiError("Guild not supported", 403);
	}
	const roles = await fetchGuildRoles(guildId.toString());
	res.status(200).json(roles);
});
