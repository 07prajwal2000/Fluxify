import { logger } from "@fluxify/common";
import { eq, isNull, or } from "drizzle-orm";
import { getAppConfigKeysFromData } from "../../api/v1/integrations/create/service";
import { integrationsGroupSchema } from "../../api/v1/integrations/schemas";
import { getDevTokenHash } from "../../api/v1/projects/settings/dev-token/service";
import { db } from "../../db";
import { putArtifact } from "../../db/natsKv";
import { integrationsEntity } from "../../db/schema";
import { EncryptionService } from "../../lib/encryption";
import type { FluxifyEnv } from "../../lib/env";
import { ENVIRONMENTS, missingIntegrationMessage } from "../../lib/envValues";
import { loadAppConfigFor } from "../../loaders/appconfigLoader";
import { configForEnv, resolveIntegrationConfig } from "../../loaders/integrationsLoader";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";
import type { ProjectConfigArtifact, ProjectConfigPayload } from "./artifacts";
import { projectConfigKey } from "./subjects";

const GROUP_FIELD = {
	[integrationsGroupSchema.enum.database]: "dbIntegrations",
	[integrationsGroupSchema.enum.kv]: "kvIntegrations",
	[integrationsGroupSchema.enum.observability]: "observabilityIntegrations",
	[integrationsGroupSchema.enum.ai]: "aiIntegrations",
	[integrationsGroupSchema.enum.queue]: "queueIntegrations",
} as const;

/**
 * What one worker needs for a project, as `env` sees it (#733): its app config,
 * and every integration resolved against that same environment's app config, so
 * `cfg:` references expand to the right values.
 *
 * Read from the rows, never from the admin's caches — those hold production
 * only. A development value that is not there is named in `missingValues`
 * rather than failing the build: it must stop the dev worker at use, and must
 * never stop production from getting its config.
 */
export async function buildProjectConfig(
	projectId: string,
	env: FluxifyEnv,
): Promise<ProjectConfigPayload> {
	const { config, missing } = await loadAppConfigFor(env, projectId);
	const appConfig = config[projectId] ?? {};
	const missingKeys = new Set(missing[projectId] ?? []);
	const groups: Record<(typeof GROUP_FIELD)[keyof typeof GROUP_FIELD], Record<string, any>> = {
		dbIntegrations: {},
		kvIntegrations: {},
		observabilityIntegrations: {},
		aiIntegrations: {},
		queueIntegrations: {},
	};
	const missingIntegrations: Record<string, string> = {};

	// scoped, not every row: an artifact is per project, so shipping them all
	// would put every tenant's database password in every other tenant's worker.
	// Unowned rows are usable by every project (see ownsIntegration).
	const rows = await db
		.select()
		.from(integrationsEntity)
		.where(or(eq(integrationsEntity.projectId, projectId), isNull(integrationsEntity.projectId)));

	for (const row of rows) {
		const field = GROUP_FIELD[row.group as keyof typeof GROUP_FIELD];
		if (!field) continue;
		const stored = configForEnv(row, env);
		if (stored === null) {
			// telemetry is lost, never a failed request: a log destination with no
			// value is simply absent on the worker, so it is not guarded there
			if (row.group === integrationsGroupSchema.enum.observability) {
				logger.warn(
					`[compiler] ${missingIntegrationMessage(row.name)}, so logs go to the console`,
					"COMPILER",
				);
				continue;
			}
			missingIntegrations[row.id] = missingIntegrationMessage(row.name);
			continue;
		}
		const lacking = getAppConfigKeysFromData(stored).find((key) => missingKeys.has(key));
		if (lacking) {
			missingIntegrations[row.id] =
				`${missingIntegrationMessage(row.name)}: it reads app config key ${lacking}, which has no development value`;
			continue;
		}
		const resolved = resolveIntegrationConfig(
			row,
			row.projectId === projectId ? appConfig : undefined,
			env,
		);
		if (resolved) groups[field][row.id] = resolved;
	}

	const payload: ProjectConfigPayload = {
		appConfig,
		...groups,
		projectSettings: (projectSettingsCache[projectId] ?? {}) as Record<string, string>,
	};
	if (missingKeys.size || Object.keys(missingIntegrations).length) {
		payload.missingValues = { integrations: missingIntegrations, appConfig: [...missingKeys] };
	}
	// development only: production has no hash, so it refuses every token (#734)
	if (env === "development") payload.devTokenHash = await getDevTokenHash(projectId);
	return payload;
}

/**
 * Seals and publishes the project's config to every environment's bucket, each
 * with its own values. Sealed, not plaintext: KV would otherwise hold every
 * tenant's database password in the clear for anyone who can read the bucket.
 */
export async function publishProjectConfig(projectId: string) {
	for (const env of ENVIRONMENTS) {
		const payload = await buildProjectConfig(projectId, env);
		const artifact: ProjectConfigArtifact = {
			projectId,
			sealed: EncryptionService.encrypt(JSON.stringify(payload)),
			compiledAt: new Date().toISOString(),
		};
		await putArtifact(projectConfigKey(projectId), artifact, env);
	}
}
