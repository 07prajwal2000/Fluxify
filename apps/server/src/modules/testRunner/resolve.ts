import { eq, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { integrationsEntity } from "../../db/schema";
import { integrationsGroupSchema } from "../../api/v1/integrations/schemas";
import { getProjectAppConfig } from "../../loaders/appconfigLoader";
import { resolveIntegrationConfig } from "../../loaders/integrationsLoader";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";
import type { ProjectConfigPayload } from "../compiler/artifacts";

export type SuiteOverrides = {
	appConfigOverrides?: Array<{ key: string; value: string }> | null;
	integrationOverrides?: Array<{ existingId: string; newId: string }> | null;
};

/**
 * Everything a test suite's child process needs, resolved in the parent — the
 * child starts cold and `setupContextVars` runs no queries, it reads caches.
 * The shape is `ProjectConfigPayload` so the child hydrates through the same
 * loaders the compiled worker uses.
 *
 * ORDER IS LOAD-BEARING: app config overrides are applied FIRST, then
 * integrations are resolved against the overridden map. Integration configs
 * hold `cfg:` references, so resolving them first expands the pre-swap values
 * and the override silently does nothing — a test quietly pointed at the real
 * database instead of the sandbox one.
 *
 * Integrations are re-resolved from their rows rather than copied out of the
 * live cache for exactly that reason: the cached ones were already expanded
 * against the un-overridden config.
 *
 * No ownership check here — the orchestrator calls `assertOverridesOwned`
 * before dispatch (#219). Only this project's rows (and unowned ones) are
 * loaded, so an override naming a foreign integration throws below.
 */
export async function resolveSuiteConfig(
	projectId: string,
	overrides: SuiteOverrides,
): Promise<ProjectConfigPayload> {
	// 1. app config first.
	const appConfig = { ...(getProjectAppConfig(projectId) ?? {}) };
	for (const { key, value } of overrides.appConfigOverrides ?? []) {
		appConfig[key] = value;
	}

	// 2. integrations second, against the overridden map.
	const rows = await db
		.select()
		.from(integrationsEntity)
		.where(
			or(
				eq(integrationsEntity.projectId, projectId),
				// unowned rows are usable by every project (see ownsIntegration)
				isNull(integrationsEntity.projectId),
			),
		);

	const payload: ProjectConfigPayload = {
		appConfig,
		dbIntegrations: {},
		kvIntegrations: {},
		observabilityIntegrations: {},
		aiIntegrations: {},
		projectSettings: projectSettingsCache[projectId] ?? {},
	};
	const byGroup: Record<string, Record<string, any>> = {
		[integrationsGroupSchema.enum.database]: payload.dbIntegrations,
		[integrationsGroupSchema.enum.kv]: payload.kvIntegrations,
		[integrationsGroupSchema.enum.observability]:
			payload.observabilityIntegrations,
		[integrationsGroupSchema.enum.ai]: payload.aiIntegrations,
	};

	for (const row of rows) {
		const bucket = byGroup[row.group ?? ""];
		if (!bucket) continue;
		const config = resolveIntegrationConfig(row, appConfig);
		if (config) bucket[row.id] = config;
	}

	// 3. integration swaps, on the freshly resolved configs.
	for (const { existingId, newId } of overrides.integrationOverrides ?? []) {
		const bucket = Object.values(byGroup).find((b) => b[newId]);
		if (!bucket) {
			throw new Error(
				`Integration override target "${newId}" was not found for this project`,
			);
		}
		bucket[existingId] = bucket[newId];
	}

	return payload;
}
