import { BadRequestError } from "@/errors";
import type { Poll } from "@/types/poll";
import { z } from "zod";

const GuildIdParamModel = z.object({
	guildId: z.coerce.number().int().positive(),
});

const PollIdParamModel = z.object({
	pollId: z.coerce.number().int().positive(),
});

export const PollFilterParamsModel = z.object({
	published: z.coerce.boolean().optional(),
	tag: z.coerce.number().int().positive().optional(),
	userId: z.coerce.bigint().positive().optional(),
	notVoted: z.coerce
		.boolean()
		.transform(() => true)
		.optional(),
});

export interface GuildIdParams {
	guildId: string;
}

export async function parseGuildId(
	params: GuildIdParams,
): Promise<Poll["guild_id"]> {
	const result = await GuildIdParamModel.safeParseAsync(params);
	if (!result.success) {
		throw new BadRequestError(
			`${params.guildId} is not a valid guild id`,
			result.error.issues,
		);
	}

	return BigInt(result.data.guildId);
}

export interface PollIdParams {
	pollId: string;
}

export async function parsePollId(params: PollIdParams): Promise<Poll["id"]> {
	const result = await PollIdParamModel.safeParseAsync(params);
	if (!result.success) {
		throw new BadRequestError(
			`${params.pollId} is not a valid poll id`,
			result.error.issues,
		);
	}

	return result.data.pollId;
}

export interface PollFilterParams {
	published?: boolean;
	tag?: number;
	userId?: bigint;
	notVoted?: boolean;
}

export async function parsePollFilterParams(
	params: PollFilterParams,
): Promise<PollFilterParams> {
	const result = await PollFilterParamsModel.safeParseAsync(params);
	if (!result.success) {
		throw new BadRequestError(
			"Invalid poll filter parameters",
			result.error.issues,
		);
	}

	return result.data;
}
