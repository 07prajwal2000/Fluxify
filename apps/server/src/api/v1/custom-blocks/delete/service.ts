import type { User } from "better-auth";
import type z from "zod";
import { db } from "../../../../db";
import { CHAN_ON_CUSTOM_BLOCK_CHANGE, publishMessage } from "../../../../db/redis";
import type { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { audit } from "../../../../modules/audit";
import { dropCustomBlock } from "../../../../modules/compiler/service";
import { assertNotInUse } from "../../../../modules/references/service";
import { hasProjectAccess } from "../../../auth/common";
import type { responseSchema } from "./dto";
import { deleteCustomBlock, getCustomBlockById } from "./repository";

export default async function handleRequest(
	id: string,
	user: User & { isSystemAdmin: boolean },
	acl: AuthACL[],
): Promise<z.infer<typeof responseSchema>> {
	let projectId: string | undefined;
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

		// #740: refused while a route, workflow, block, middleware, promoted version or
		// test hook uses it, and it says which. Sandboxes do not count.
		await assertNotInUse(
			"custom_block",
			{ id, name: existingBlock.name, projectId: existingBlock.projectId! },
			tx,
		);

		projectId = existingBlock.projectId!;
		await deleteCustomBlock(id, tx);
		await audit.record({
			projectId,
			resourceType: "custom_block",
			resourceId: id,
			action: "delete",
			changedFields: [],
		});
	});

	// same as routes: the compiler can't resolve the project of a row that no
	// longer exists, so the stale artifact would keep being served from KV
	if (projectId) await dropCustomBlock(projectId, id);
	await publishMessage(CHAN_ON_CUSTOM_BLOCK_CHANGE, id);

	return { id };
}
