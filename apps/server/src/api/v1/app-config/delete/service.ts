import { db } from "../../../../db";
import { CHAN_ON_APPCONFIG_CHANGE, publishMessage } from "../../../../db/redis";
import { BadRequestError } from "../../../../errors/badRequestError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { checkAppConfigExist, deleteAppConfig } from "./repository";

export default async function handleRequest(projectId: string, id: number) {
	if (!id || isNaN(id)) {
		throw new BadRequestError("Invalid ID");
	}
	await db.transaction(async (tx) => {
		const exist = await checkAppConfigExist(id, projectId, tx);
		if (!exist) {
			throw new NotFoundError("App config not found");
		}
		const result = await deleteAppConfig(id, projectId, tx);
		if (!result) {
			throw new BadRequestError("Failed to delete app config");
		}
	});
	await publishMessage(CHAN_ON_APPCONFIG_CHANGE, "");
}
