import { appConfigKeys, integrationRegistry } from "@fluxify/adapters/integrations";
import { generateID } from "@fluxify/lib";
import type { z } from "zod";
import { db } from "../../../../db";
import { CHAN_ON_INTEGRATION_CHANGE, publishMessage } from "../../../../db/redis";
import { ConflictError } from "../../../../errors/conflictError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { audit, bodyFields } from "../../../../modules/audit";
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
		const appConfigKeysFromCfg = [
			...getAppConfigKeysFromData(data.config),
			...getAppConfigKeysFromData(data.devConfig),
		];
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
				devConfig: data.devConfig ?? null,
				syncDev: data.syncDev ?? false,
				projectId,
				tags: integrationRegistry.tags(data.group, data.variant).join(","),
			},
			tx,
		);
		await audit.record({
			projectId,
			resourceType: "integration",
			resourceId: generatedID,
			action: "create",
			changedFields: bodyFields(data),
		});
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

export const getAppConfigKeysFromData = appConfigKeys;
