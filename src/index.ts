import { createServer } from "node:http";

import { createApp } from "./app";
import "./utils";
import config from "./config";

async function startServer() {
  try {
    const app = await createApp();
    const server = createServer(app);
    server.listen(config.api.port, "0.0.0.0", () => {
      console.log(`⚡[server]: Server is running on port ${config.api.port}`);
    });
    console.log("Server started successfully with persistent sessions");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
