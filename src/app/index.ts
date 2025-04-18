import cors from "cors";
import express from "express";

import { apiRouter } from "@/routes";
import config from "@/config";
import { createServer } from "node:http";

export function createApp() {
	const app = express();

	const corsOptions = {
		origin: config.frontendUrl,
		credentials: true,
	};
	app.use(cors(corsOptions));

	app.use(express.json());
	app.use(express.urlencoded({ extended: false }));
	app.use(apiRouter);

	const server = createServer(app);

	server.listen(config.api.port, () => {
		console.log(`⚡[server]: Server is running on port ${config.api.port}`);
	});

	return {};
}
