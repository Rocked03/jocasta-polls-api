import { Router } from "express";

import { pollRouter } from "./poll";
import { tagRouter } from "./tag";
import { guildRouter } from "./guild";
import { authRouter } from "./auth";
import { discordRouter } from "./discord";
import { healthRouter } from "./health";
import { botRouter } from "./bot";

export const apiV1Router = Router();

apiV1Router.use("/polls", pollRouter);
apiV1Router.use("/tags", tagRouter);
apiV1Router.use("/guilds", guildRouter);
apiV1Router.use("/auth", authRouter);
apiV1Router.use("/discord", discordRouter);
apiV1Router.use("/bot", botRouter);
apiV1Router.use("/health", healthRouter);
