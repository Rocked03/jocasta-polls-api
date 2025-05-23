import { prisma } from "@/client";
import type { Vote } from "@/types";

export async function getVote(
	pollId: number,
	userId: bigint,
): Promise<Vote | null> {
	const vote = await prisma.pollsvotes.findFirst({
		where: {
			poll_id: pollId,
			user_id: userId,
		},
	});

	if (!vote) return null;

	return vote;
}

export async function getVotesByPoll(
	pollId: number,
): Promise<{ choice: number; votes: number }[]> {
	const votes = await prisma.pollsvotes.groupBy({
		by: ["choice"],
		where: {
			poll_id: pollId,
		},
		_count: {
			choice: true,
		},
	});

	return votes.map((vote) => ({
		choice: vote.choice,
		votes: vote._count.choice,
	}));
}

export async function getVotesByUser(userId: bigint): Promise<Vote[]> {
	const votes = await prisma.pollsvotes.findMany({
		where: {
			user_id: userId,
		},
	});

	return votes;
}
