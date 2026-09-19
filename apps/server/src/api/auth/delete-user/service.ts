import type { User } from "better-auth";
import type { z } from "zod";
import { db } from "../../../db";
import { deleteCacheKey, getCache } from "../../../db/redis";
import { BadRequestError } from "../../../errors/badRequestError";
import { auth } from "../../../lib/auth";
import { revokeSessions } from "../common";
import type { requestParamsSchema } from "./dto";
import { deleteUser, getUserRole } from "./repository";

export default async function handleRequest(
	user: User,
	params: z.infer<typeof requestParamsSchema>,
) {
	if (user.id === params.userId) {
		throw new BadRequestError("You are not allowed to delete your own account");
	}
	await db.transaction(async (tx) => {
		const userToDelete = await getUserRole(params.userId, tx);

		if (userToDelete?.isSystemAdmin) {
			throw new BadRequestError("You are not allowed to delete a system admin");
		}

		await deleteUser(params.userId, tx);
		await revokeSessions(params.userId);
	});

	return {
		message: "User deleted successfully",
	};
}
