import { integrationRegistry } from "@fluxify/adapters/integrations";
import type { z } from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { CHAN_ON_INTEGRATION_CHANGE, publishMessage } from "../../../../db/redis";
import { ConflictError } from "../../../../errors/conflictError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { ValidationError } from "../../../../errors/validationError";
import { mapZodErrorToFieldErrors } from "../../../../lib/errors";
import { audit, changedFields } from "../../../../modules/audit";
import { getAppConfigKeys } from "../create/repository";
import { getAppConfigKeysFromData } from "../create/service";
import { redactIntegration } from "../mcp-oauth/store";
import { variantConfigSchema } from "../variants/service";
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
		if (body.devConfig != null) {
			await validateAppConfig(
				projectId,
				body.devConfig,
				integration.group!,
				integration.variant!,
				tx,
			);
		}
		const updatedIntegration = await updateIntegration(
			projectId,
			id,
			{
				...body,
				// a normal update never wipes the OAuth connection; only Connect, refresh and Disconnect write it
				...(integration.group === "mcp" ? sanitizeMcpOAuth(integration, body) : {}),
				tags: integrationRegistry.tags(integration.group!, integration.variant!),
			},
			tx,
		);
		await audit.record({
			projectId,
			resourceType: "integration",
			resourceId: id,
			action: "update",
			changedFields: changedFields(integration, body),
		});
		return updatedIntegration;
	});
	if (!result) {
		throw new ServerError("Failed to update integration");
	}
	await publishMessage(CHAN_ON_INTEGRATION_CHANGE, result.id);
	return redactIntegration(result);
}

type McpConfig = { url?: string; auth?: string; oauth?: unknown };

/**
 * An mcp update never carries tokens in (the client only ever saw their status) and keeps the
 * stored ones, unless the connection no longer fits: another server, or headers instead of OAuth.
 */
function sanitizeMcpOAuth(
	stored: { config: unknown; devConfig: unknown },
	body: z.infer<typeof requestBodySchema>,
) {
	// an update that leaves `auth` out keeps the stored one, so rewriting the headers cannot sign OAuth out
	const strip = (config: McpConfig | null | undefined, was: McpConfig | null) => {
		const { oauth: _status, ...rest } = config ?? {};
		return { ...rest, auth: rest.auth ?? was?.auth ?? "headers" };
	};
	const fits = (was: McpConfig | null, next: McpConfig) =>
		!!was?.oauth && next.auth === "oauth" && next.url === was.url;
	const config = strip(body.config, stored.config as McpConfig);
	const devConfig =
		body.devConfig == null ? body.devConfig : strip(body.devConfig, stored.devConfig as McpConfig);
	return {
		config,
		devConfig,
		keepOAuth: {
			config: fits(stored.config as McpConfig, config),
			devConfig: devConfig != null && fits(stored.devConfig as McpConfig, devConfig),
		},
	};
}

async function validateAppConfig(
	projectId: string,
	appConfig: any,
	group: string,
	variant: string,
	tx: DbTransactionType,
) {
	const parsedResult = variantConfigSchema(group, variant).safeParse(appConfig);
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
