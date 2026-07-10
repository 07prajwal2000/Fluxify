import z from "zod";
import { responseSchema } from "./dto";
import { db } from "../../../../db";
import { getCustomBlockById, deleteCustomBlock } from "./repository";
import { publishMessage, CHAN_ON_CUSTOM_BLOCK_CHANGE } from "../../../../db/redis";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ForbiddenError } from "../../../../errors/forbidError";
import { hasProjectAccess } from "../../../auth/common";
import { AuthACL } from "../../../../db/schema";
import { User } from "better-auth";

export default async function handleRequest(
  id: string,
  user: User & { isSystemAdmin: boolean },
  acl: AuthACL[]
): Promise<z.infer<typeof responseSchema>> {
  await db.transaction(async (tx) => {
    const existingBlock = await getCustomBlockById(id, tx);
    if (!existingBlock) {
      throw new NotFoundError("Custom block not found");
    }

    if (!hasProjectAccess(user, acl, existingBlock.projectId!, "creator")) {
      throw new ForbiddenError();
    }

    if (existingBlock.sourceType === "plugin") {
      throw new ForbiddenError("Cannot delete a custom block originating from a plugin");
    }

    await deleteCustomBlock(id, tx);
    await publishMessage(CHAN_ON_CUSTOM_BLOCK_CHANGE, id);
  });

  return { id };
}
