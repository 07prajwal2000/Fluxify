import type { User } from "better-auth";
import type z from "zod";
import { db } from "../../../../db";
import { CHAN_ON_CUSTOM_BLOCK_CHANGE, publishMessage } from "../../../../db/redis";
import type { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { hasProjectAccess } from "../../../auth/common";
import type { requestBodySchema, responseSchema } from "./dto";
import { getCustomBlockById, updateCustomBlock } from "./repository";

export default async function handleRequest(
	id: string,
	data: z.infer<typeof requestBodySchema>,
	user: User & { isSystemAdmin: boolean },
	acl: AuthACL[],
): Promise<z.infer<typeof responseSchema>> {
	const result = await db.transaction(async (tx) => {
		const existingBlock = await getCustomBlockById(id, tx);
		if (!existingBlock) {
			throw new NotFoundError("Custom block not found");
		}

		if (!hasProjectAccess(user, acl, existingBlock.projectId!, "creator")) {
			throw new ForbiddenError();
		}

		// Name and usage are omitted from the update DTO: both are fixed at create
		// (#534), so there is no conflict or "still in use" check to make here

		// a middleware link is never configured, so it carries no params
		if (existingBlock.usage === "middleware") data.inputParams = [];

		const updated = await updateCustomBlock(id, data, tx);
		if (!updated) {
			throw new ServerError("Failed to update custom block");
		}
		return updated;
	});

	await publishMessage(CHAN_ON_CUSTOM_BLOCK_CHANGE, id);

	return {
		id: result.id,
	};
}
