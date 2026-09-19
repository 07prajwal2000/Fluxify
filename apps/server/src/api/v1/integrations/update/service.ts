import type { z } from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { CHAN_ON_INTEGRATION_CHANGE, publishMessage } from "../../../../db/redis";
import { ConflictError } from "../../../../errors/conflictError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { ValidationError } from "../../../../errors/validationError";
import { mapZodErrorToFieldErrors } from "../../../../lib/errors";
import { getAppConfigKeys } from "../create/repository";
import { getAppConfigKeysFromData } from "../create/service";
import { getSchema } from "../helpers";
import { getIntegrationTags } from "../schemas";
import type { requestBodySchema, responseSchema } from "./dto";
import { getIntegrationById, integrationExistByName, updateIntegration } from "./repository";

export default async function handleRequest(
	projectId: string,
	id: string,
	body: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
	const result = await db.transaction(async (tx) => {
		const integration = await getIntegrationById(projectId, id, tx);
		if (!integration) {
			throw new NotFoundError("Integration not found");
		}
		const integrationExist = await integrationExistByName(projectId, body.name, tx);
		if (integrationExist && integrationExist.id !== id) {
			throw new ConflictError("Integration name already exists");
		}
		await validateAppConfig(projectId, body.config, integration.group!, integration.variant!, tx);
		const updatedIntegration = await updateIntegration(
			projectId,
			id,
			{
				...body,
				tags: getIntegrationTags(integration.group as any, integration.variant!),
			},
			tx,
		);
		return updatedIntegration;
	});
	if (!result) {
		throw new ServerError("Failed to update integration");
	}
	await publishMessage(CHAN_ON_INTEGRATION_CHANGE, result.id);
	return result;
}

async function validateAppConfig(
	projectId: string,
	appConfig: any,
	group: string,
	variant: string,
	tx: DbTransactionType,
) {
	const schema = getSchema(group as any, variant as any);
	const parsedResult = schema!.safeParse(appConfig);
	if (!parsedResult.success) {
		throw new ValidationError(mapZodErrorToFieldErrors(parsedResult.error));
	}
	const appConfigKeys = getAppConfigKeysFromData(appConfig);
	const keysFromDB = new Set(await getAppConfigKeys(projectId, tx));
	for (const key of appConfigKeys) {
		if (!keysFromDB.has(key)) {
			throw new NotFoundError(`App config '${key}' not found`);
		}
	}
}
