import { NextFunction, Request, RequestHandler, Response } from "express";

import { getBotServiceToken, verifyBotServiceToken } from "@/auth/botServiceToken";
import { runBotContext, BotContext } from "@/context/botContext";
import { ApiError, BadRequestError, UnauthorizedError } from "@/errors";

const SNOWFLAKE_PATTERN = /^\d{1,20}$/;

export const requireBotServiceToken: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!getBotServiceToken()) {
    ApiError.sendError(res, new ApiError("Bot authentication not configured", 503));
    return;
  }

  const authorization = req.get("Authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) {
    ApiError.sendError(res, new UnauthorizedError("Missing or malformed Authorization header"));
    return;
  }

  const presented = authorization.slice("Bearer ".length);
  if (!verifyBotServiceToken(presented)) {
    ApiError.sendError(res, new UnauthorizedError("Invalid service token"));
    return;
  }

  const rawUserId = req.get("X-Discord-User-Id");
  if (rawUserId !== undefined && !SNOWFLAKE_PATTERN.test(rawUserId)) {
    ApiError.sendError(
      res,
      new BadRequestError("X-Discord-User-Id must be a Discord user id (digits only)"),
    );
    return;
  }

  const store: BotContext = {
    isBotCall: true,
    userId: rawUserId,
    managementOverride: true,
  };

  runBotContext(store, () => next());
};
