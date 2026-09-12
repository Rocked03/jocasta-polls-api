import config from "@/config";
import passport from "passport";
import type { Express } from "express";
import { Strategy as DiscordStrategy } from "passport-discord";
import session from "express-session";
import type { DiscordUserProfile } from "@/types/discordUserProfile";
import { createClient } from "redis";
import MemoryStore from "memorystore";
import type { Store } from "express-session";

const discordStrategy = new DiscordStrategy(
  {
    clientID: config.auth.discord.clientId,
    clientSecret: config.auth.discord.clientSecret,
    callbackURL: config.auth.discord.redirectUri,
    scope: ["identify", "guilds", "guilds.members.read"],
  },
  (accessToken, _refreshToken, profile, done) => {
    const discordProfile = profile as DiscordUserProfile;
    discordProfile.accessToken = accessToken;
    done(null, discordProfile);
  }
);

async function createSessionStore(): Promise<Store> {
  console.log("Redis enabled:", config.redis.enabled);
  console.log("Redis URL:", config.redis.url);

  if (config.redis.enabled) {
    try {
      // Import RedisStore from connect-redis (v7+ syntax)
      const { RedisStore } = (await import("connect-redis")) as any;
      console.log("RedisStore imported successfully");

      console.log("Attempting to create Redis client...");
      const redisClient = createClient({
        url: config.redis.url,
      });

      redisClient.on("error", (err) => {
        console.error("Redis Client Error:", err);
      });

      redisClient.on("connect", () => {
        console.log("Redis client connected successfully");
      });

      redisClient.on("ready", () => {
        console.log("Redis client ready");
      });

      console.log("Connecting to Redis...");
      await redisClient.connect();
      console.log("Connected to Redis for session storage");

      // Create RedisStore instance (connect-redis v7+ pattern)
      const redisStore = new RedisStore({
        client: redisClient,
        prefix: "jocasta-polls:",
      });

      console.log("Redis store created successfully");
      return redisStore;
    } catch (error) {
      console.error("Failed to connect to Redis:", error);
      console.warn("Falling back to memory-based session store");
    }
  } else {
    console.log("Redis disabled in config");
  }

  // Fallback to memory-based session store
  const MemoryStoreSession = MemoryStore(session);
  console.log("Using memory-based session storage with TTL");
  return new MemoryStoreSession({
    checkPeriod: 86400000, // prune expired entries every 24h
    ttl: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    max: 1000, // max number of sessions
  });
}

export async function initializeAuth(app: Express) {
  passport.serializeUser((user, done) => {
    done(null, user);
  });

  passport.deserializeUser<DiscordUserProfile>((user, done) => {
    done(null, user);
  });

  passport.use(discordStrategy);

  const isProduction = config.environment === "production";
  const store = await createSessionStore();

  app.use(
    session({
      store,
      secret: config.expressSessionSecret,
      resave: false,
      saveUninitialized: true,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());
}
