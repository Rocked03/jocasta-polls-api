import { prisma } from "@/client";
import { BadRequestError, NotFoundError } from "@/errors";
import { Prisma } from "@/generated/prisma/client";
import type { Tag } from "@/types";
import { emitBotEvent } from "@/websocket/botEventEmitter";

export interface TagFilterOptions {
	publishedOnly?: boolean;
	end_message_self_assign?: boolean;
	end_message_replace?: boolean;
}

export async function getTags(options: TagFilterOptions = {}): Promise<Tag[]> {
	const tags = await prisma.tag.findMany({
		where: {
			end_message_self_assign: options.end_message_self_assign,
			end_message_replace: options.end_message_replace,
		},
		include: {
			polls: {
				where: options.publishedOnly ? { published: true } : {},
			orderBy: {
				start_time: "desc",
			},
				take: 1,
			},
		},
	});

	tags.sort((a, b) => {
		const aTime = a.polls[0]?.start_time
			? new Date(a.polls[0].start_time).getTime()
			: 0;
		const bTime = b.polls[0]?.start_time
			? new Date(b.polls[0].start_time).getTime()
			: 0;
		return bTime - aTime;
	});

	return tags;
}

export async function getTagById(id: number): Promise<Tag | null> {
	const tag = await prisma.tag.findUnique({
		where: {
			tag: id,
		},
	});

	if (!tag) return null;

	return tag;
}

export interface TagCreateInput {
	name?: unknown;
	guild_id?: string | number | bigint;
	channel_id?: string | number | bigint;
	crosspost_channels?: Array<string | number | bigint>;
	crosspost_servers?: Array<string | number | bigint>;
	current_num?: number | null;
	colour?: number | null;
	end_message?: string | null;
	end_message_latest_ids?: Array<string | number | bigint>;
	end_message_replace?: boolean;
	end_message_role_ids?: Array<string | number | bigint>;
	end_message_ping?: boolean;
	end_message_self_assign?: boolean;
	persistent?: boolean;
}

export async function createTag(tagData: TagCreateInput): Promise<Tag> {
	if (!tagData.name || typeof tagData.name !== "string") {
		throw new BadRequestError("Tag name is required and must be a string");
	}
	if (!tagData.guild_id) {
		throw new BadRequestError("guild_id is required");
	}
	if (!tagData.channel_id) {
		throw new BadRequestError("channel_id is required");
	}

	const existingTag = await prisma.tag.findFirst({
		where: {
			guild_id: BigInt(tagData.guild_id),
			name: tagData.name,
		},
	});

	if (existingTag) {
		throw new BadRequestError(
			`Tag name "${tagData.name}" already exists in this guild`
		);
	}

	let tagId: number;
	while (true) {
		tagId = Math.floor(Math.random() * 90000) + 10000;
		const existing = await prisma.tag.findUnique({
			where: { tag: tagId },
		});
		if (!existing) break;
	}

	const createdTag = await prisma.tag.create({
		data: {
			tag: tagId,
			name: tagData.name,
			guild_id: BigInt(tagData.guild_id),
			channel_id: BigInt(tagData.channel_id),
			crosspost_channels:
				tagData.crosspost_channels?.map((id) => BigInt(id)) ?? [],
			crosspost_servers:
				tagData.crosspost_servers?.map((id) => BigInt(id)) ?? [],
			current_num: tagData.current_num ?? null,
			colour: tagData.colour ?? null,
			end_message: tagData.end_message ?? null,
			end_message_latest_ids:
				tagData.end_message_latest_ids?.map((id) => BigInt(id)) ?? [],
			end_message_replace: tagData.end_message_replace ?? false,
			end_message_role_ids:
				tagData.end_message_role_ids?.map((id) => BigInt(id)) ?? [],
			end_message_ping: tagData.end_message_ping ?? false,
			end_message_self_assign: tagData.end_message_self_assign ?? false,
			persistent: tagData.persistent ?? true,
		},
	});

	console.log(`Created tag "${createdTag.name}" with ID ${createdTag.tag}`);

	emitBotEvent("tags", "create", createdTag.tag);

	return createdTag;
}

/**
 * Tag fields no update may touch: the PK (lookup only), guild_id
 * (immutable), and current_num (lifecycle-owned counter, incremented
 * by publish). `satisfies` pins each name to the Prisma model so a
 * schema rename breaks the build.
 */
const TAG_RESTRICTED_FIELDS = [
	"tag",
	"guild_id",
	"current_num",
] as const satisfies readonly (keyof typeof Prisma.TagScalarFieldEnum)[];

/**
 * Updatable tag fields, derived from the Prisma model: everything
 * except the restricted ones. A new model field is updatable only by
 * not being restricted here.
 */
export const TAG_UPDATABLE_FIELDS = (
	Object.keys(
		Prisma.TagScalarFieldEnum,
	) as (keyof typeof Prisma.TagScalarFieldEnum)[]
).filter(
	(field) =>
		!(TAG_RESTRICTED_FIELDS as readonly string[]).includes(field)
);

export type TagUpdatableField = Exclude<
	keyof typeof Prisma.TagScalarFieldEnum,
	(typeof TAG_RESTRICTED_FIELDS)[number]
>;

/**
 * Update whitelist keyed on the derived updatable fields with their
 * model types, all optional.
 */
export type TagUpdateInput = Partial<
	Pick<Prisma.TagModel, TagUpdatableField>
>;

export async function updateTag(
	id: number,
	data: TagUpdateInput
): Promise<Tag> {
	const existing = await prisma.tag.findUnique({
		where: { tag: id },
	});

	if (!existing) {
		throw new NotFoundError(`Tag with id ${id} not found`);
	}

	for (const key of Object.keys(data)) {
		if (!TAG_UPDATABLE_FIELDS.includes(key as TagUpdatableField)) {
			throw new BadRequestError(
				`'${key}' cannot be set via tag update`
			);
		}
	}

	const updatedTag = await prisma.tag.update({
		where: { tag: id },
		data,
	});

	emitBotEvent("tags", "update", id);

	return updatedTag;
}
