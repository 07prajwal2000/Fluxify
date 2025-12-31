import { User } from "better-auth";
import { z } from "zod";
import { BadRequestError } from "../../../errors/badRequestError";
import { requestParamsSchema } from "./dto";
import { deleteUser, getUserRole } from "./repository";
import { db } from "../../../db";
import { auth } from "../../../lib/auth";
import { deleteCacheKey, getCache } from "../../../db/redis";
import { revokeSessions } from "../common";

export default async function handleRequest(
  user: User,
  params: z.infer<typeof requestParamsSchema>
) {
  if (user.id === params.userId) {
    throw new BadRequestError("You are not allowed to delete your own account");
  }
  await db.transaction(async (tx) => {
    const userToDelete = await getUserRole(params.userId, tx);

    if (userToDelete?.role === "instance_admin") {
      throw new BadRequestError(
        "You are not allowed to delete an instance admin"
      );
    }

    await deleteUser(params.userId, tx);
    await revokeSessions(params.userId);
  });

  return {
    message: "User deleted successfully",
  };
}
