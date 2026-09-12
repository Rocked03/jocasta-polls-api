import { prisma } from "@/client";
import type { PollInfo } from "@/types";

export interface GuildFilterOptions {
  manage_channel_id?: bigint;
}

export async function getGuilds(
  options: GuildFilterOptions = {}
): Promise<PollInfo[]> {
  const guilds = await prisma.guildSettings.findMany({
    where: {
      manage_channel_id:
        options.manage_channel_id === undefined
          ? undefined
          : { has: options.manage_channel_id },
    },
  });

  return guilds;
}

export async function getGuildById(id: bigint): Promise<PollInfo | null> {
  const guild = await prisma.guildSettings.findUnique({
    where: {
      guild_id: id,
    },
  });

  if (!guild) return null;

  return guild;
}
