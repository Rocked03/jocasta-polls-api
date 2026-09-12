import { Router } from "express";

import { requireBotServiceToken } from "@/middleware/requireBotServiceToken";
import { botPollRouter } from "./poll";
import { botTagRouter } from "./tag";
import { botGuildRouter } from "./guild";
import { botDiscordRouter } from "./discord";

export const botRouter = Router();

botRouter.use(requireBotServiceToken);

botRouter.use("/polls", botPollRouter);
botRouter.use("/tags", botTagRouter);
botRouter.use("/guilds", botGuildRouter);
botRouter.use("/discord", botDiscordRouter);
