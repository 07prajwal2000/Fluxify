import {
	upsertProjectSettingKey,
	checkProjectExists,
	markIntegrationForHarness,
} from "./repository";
import {
	CHAN_ON_INTEGRATION_CHANGE,
	CHAN_ON_PROJECT_SETTING_CHANGE,
	publishMessage,
	setCache,
} from "../../../../../../db/redis";
import { getProjectSettingsKeys } from "../get-all/repository";
import {
	projectSettingsKeySchemaMap,
	ProjectSettingsKeyType,
} from "../keySchemaMap";
import { BadRequestError } from "../../../../../../errors/badRequestError";
import { NotFoundError } from "../../../../../../errors/notFoundError";

import { testConnectionFn } from "./connection";
import { constructProjectSettingCacheKey } from "../../../../../../lib/project-settings";

export default async function handleRequest(
	projectId: string,
	payload: { key: string; value?: string },
) {
	const projectExists = await checkProjectExists(projectId);
	if (!projectExists) {
		throw new NotFoundError("Project not found");
	}

	const { key, value } = payload;
	const schemaMap = projectSettingsKeySchemaMap[key as ProjectSettingsKeyType];

	if (!schemaMap) {
		throw new BadRequestError("Invalid key");
	}

	let finalValue = value;
	if (finalValue === undefined || finalValue === null || finalValue === "") {
		finalValue = schemaMap.defaultValue;
	}

	const parsed = schemaMap.schema.safeParse(finalValue);
	if (!parsed.success && finalValue !== schemaMap.defaultValue) {
		throw new BadRequestError(`Invalid value for key ${key}`);
	}

	if (
		finalValue &&
		(key === "settings.ai.agentConnectionId" ||
			key === "settings.ai.loggerConnectionId" ||
			key.startsWith("settings.telemetry."))
	) {
		const connectionTest = await testConnectionFn(
			key as ProjectSettingsKeyType,
			finalValue,
		);
		if (!connectionTest.success) {
			throw new BadRequestError(connectionTest.message);
		}
	}

	await upsertProjectSettingKey(projectId, key, finalValue);

	if (key === "settings.ai.agentConnectionId" && finalValue) {
		await markIntegrationForHarness(projectId, finalValue);
		await publishMessage(CHAN_ON_INTEGRATION_CHANGE, finalValue);
	}

	const cacheKey = constructProjectSettingCacheKey(projectId);
	const settings = await getProjectSettingsKeys(projectId);

	const result: Record<string, string> = {};
	for (const s of settings) {
		result[s.key] = s.value;
	}
	const strResult = JSON.stringify(result);
	await Promise.all([
		setCache(cacheKey, strResult),
		publishMessage(CHAN_ON_PROJECT_SETTING_CHANGE, strResult),
	]);

	return { message: "Setting saved successfully" };
}
