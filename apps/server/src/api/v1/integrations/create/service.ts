import { generateID } from "@fluxify/lib";
import type { z } from "zod";
import { db } from "../../../../db";
import { CHAN_ON_INTEGRATION_CHANGE, publishMessage } from "../../../../db/redis";
import { ConflictError } from "../../../../errors/conflictError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { getIntegrationTags } from "../schemas";
import type { requestBodySchema, responseSchema } from "./dto";
import { createIntegration, getAppConfigKeys, integrationExistByName } from "./repository";

export default async function handleRequest(
	projectId: string,
	data: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
	const result = await db.transaction(async (tx) => {
		const exist = await integrationExistByName(projectId, data.name, tx);
		if (exist) {
			throw new ConflictError("Integration already exists");
		}
		const generatedID = generateID();
		const appConfigKeysFromCfg = getAppConfigKeysFromData(data.config);
		if (appConfigKeysFromCfg.length > 0) {
			// tiny optimization
			const appConfigKeysFromDB = new Set(await getAppConfigKeys(projectId, tx));
			for (const key of appConfigKeysFromCfg) {
				if (!appConfigKeysFromDB.has(key)) {
					throw new NotFoundError(`App config '${key}' not found`);
				}
			}
		}
		await createIntegration(
			{
				id: generatedID,
				name: data.name,
				group: data.group,
				variant: data.variant,
				config: data.config,
				projectId,
				tags: getIntegrationTags(data.group, data.variant).join(","),
			},
			tx,
		);
		return generatedID;
	});

	if (!result) {
		throw new ServerError("Failed to create integration");
	}

	await publishMessage(CHAN_ON_INTEGRATION_CHANGE, result);

	return {
		id: result,
	};
}

export function getAppConfigKeysFromData(integrationConfig: any) {
	if (typeof integrationConfig !== "object") return [];
	const keys = [] as string[];
	const q = [integrationConfig] as any[];

	while (q.length > 0) {
		const obj = q.shift()!;
		for (const key in obj) {
			const value = obj[key];
			if (typeof value === "object") {
				q.push(value);
			}
			if (typeof value === "string" && value.startsWith("cfg:")) {
				keys.push(value.slice(4));
			}
		}
	}
	return keys;
}
