import type { RequestHandler } from "express";

import config from "@/config";
import { getBotContext } from "@/context/botContext";
import { ApiError, BadRequestError, ForbiddenError } from "@/errors";
import { getGuildMemberRoles } from "@/services/discordService";
import { getGuildById } from "@/services/guildService";

/**
 * Fail-closed Discord revalidation for the bot's write operations
 * (create/update/delete/update-by-tag). Mounted per-route inside the bot
 * tree, beneath the tree-wide service-token gate. The API itself
 * verifies the acting user's manager roles via the bot token on every
 * request (no caching): missing acting user -> 400, Discord
 * unreachable/unexpected failure -> 503, no manager-role intersection
 * -> 403. Votes and reads stay trusted.
 */
export const requireDiscordRevalidation: RequestHandler = async (
  req,
  _res,
  next,
) => {
  const userId = getBotContext()?.userId;
  if (!userId) {
    throw new BadRequestError(
      "X-Discord-User-Id header is required for this operation",
    );
  }
  try {
    const roles = await getGuildMemberRoles(config.guildId, BigInt(userId));
    const settings = await getGuildById(config.guildId);
    const managerRoles = settings?.manager_role_id ?? [];
    const isManager = roles.some((role) => managerRoles.includes(role));
    if (!isManager) {
      throw new ForbiddenError("Missing management permissions");
    }
    next();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "Could not verify permissions (Discord unavailable)",
      503,
    );
  }
};
