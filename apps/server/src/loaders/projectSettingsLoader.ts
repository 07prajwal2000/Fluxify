import { logger } from "@fluxify/common";
import {
	CHAN_ON_PROJECT_SETTING_CHANGE,
	subscribeToChannel,
} from "../db/redis";
import { getAllProjectSettings } from "../lib/project-settings";
import z from "zod";
import { projectSettingsKeySchemaMap } from "../api/v1/projects/settings/keys/keySchemaMap";

export let projectSettingsCache: Record<
	string,
	Record<keyof typeof projectSettingsKeySchemaMap, string>
> = {};
let settingsLoaded = false;

export async function loadProjectSettings() {
	if (settingsLoaded) {
		return;
	}
	projectSettingsCache = await getAllProjectSettings();
	settingsLoaded = true;
	logger.info("project settings loaded");
	await subscribeToChannel(CHAN_ON_PROJECT_SETTING_CHANGE, async (id) => {
		projectSettingsCache = await getAllProjectSettings();
		const { invalidateOpenApiCache } = await import("../api/v1/routes/openapi/service");
		await invalidateOpenApiCache(id);
		logger.info("project settings reloaded");
	});
}
