import type { z } from "zod";
import { db } from "../../../../db";
import { CHAN_ON_APPCONFIG_CHANGE, publishMessage } from "../../../../db/redis";
import { BadRequestError } from "../../../../errors/badRequestError";
import type { requestBodySchema, responseSchema } from "./dto";
import { checkAppConfigsExist, deleteAppConfigBulk } from "./repository";

export default async function handleRequest(
	projectId: string,
	body: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
	const { ids } = body;

	if (!ids || ids.length === 0) {
		throw new BadRequestError("At least one ID is required");
	}

	await db.transaction(async (tx) => {
		const allExist = await checkAppConfigsExist(ids, projectId, tx);
		if (!allExist) {
			throw new BadRequestError("One or more app configs not found");
		}
		const deletedCount = await deleteAppConfigBulk(ids, projectId, tx);
		if (deletedCount === 0) {
			throw new BadRequestError("Failed to delete app configs");
		}
	});

	await publishMessage(CHAN_ON_APPCONFIG_CHANGE, "");
	return {};
}
