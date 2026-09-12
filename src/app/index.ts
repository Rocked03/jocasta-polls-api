import cors from "cors";
import express from "express";

import { apiRouter } from "@/routes";
import config from "@/config";
import { initializeAuth } from "@/auth/passport";
import { errorHandler } from "@/middleware/errorHandler";

export async function createApp() {
  const app = express();

  const corsOptions = {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow: boolean) => void
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      // Allow requests from your domain and Netlify
      const allowedOrigins = [
        config.frontendUrl,
        "https://polls.marvelcord.com",
        "https://marvel-discord.netlify.app",
      ];

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log("CORS blocked origin:", origin);
        callback(new Error("Not allowed by CORS"), false);
      }
    },
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "rsc",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  };

  app.use(cors(corsOptions));

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.set("trust proxy", 1);

  await initializeAuth(app);

  app.use(apiRouter);

  app.use(errorHandler);

  return app;
}
