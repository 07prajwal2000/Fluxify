import { z } from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import { db, DbTransactionType } from "../../../../db";
import {
	getIntegrationById,
	updateIntegration,
	integrationExistByName,
} from "./repository";
import { NotFoundError } from "../../../../errors/notFoundError";
import { getSchema } from "../helpers";
import { ValidationError } from "../../../../errors/validationError";
import { mapZodErrorToFieldErrors } from "../../../../lib/errors";
import { ServerError } from "../../../../errors/serverError";
import {
	CHAN_ON_INTEGRATION_CHANGE,
	publishMessage,
} from "../../../../db/redis";
import { getAppConfigKeysFromData } from "../create/service";
import { getAppConfigKeys } from "../create/repository";
import { ConflictError } from "../../../../errors/conflictError";
import { getIntegrationTags } from "../schemas";

export default async function handleRequest(
	id: string,
	body: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
	const result = await db.transaction(async (tx) => {
		const integration = await getIntegrationById(id, tx);
		if (!integration) {
			throw new NotFoundError("Integration not found");
		}
		const integrationExist = await integrationExistByName(body.name, tx);
		if (integrationExist && integrationExist.id !== id) {
			throw new ConflictError("Integration name already exists");
		}
		await validateAppConfig(
			body.config,
			integration.group!,
			integration.variant!,
			tx,
		);
		const updatedIntegration = await updateIntegration(
			id,
			{
				...body,
				tags: getIntegrationTags(
					integration.group as any,
					integration.variant!,
				),
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
	const keysFromDB = new Set(await getAppConfigKeys(tx));
	for (const key of appConfigKeys) {
		if (!keysFromDB.has(key)) {
			throw new NotFoundError(`App config '${key}' not found`);
		}
	}
}
