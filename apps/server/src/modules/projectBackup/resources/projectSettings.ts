import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import {
	type ProjectSettingsKeyType,
	projectSettingsKeySchemaMap,
} from "../../../api/v1/projects/settings/keys/keySchemaMap";
import { upsertProjectSettingKey } from "../../../api/v1/projects/settings/keys/upsert/repository";
import { type DbTransactionType, db } from "../../../db";
import { CHAN_ON_PROJECT_SETTING_CHANGE, deleteCacheKey, publishMessage } from "../../../db/redis";
import { projectSettingsEntity } from "../../../db/schema";
import { constructProjectSettingCacheKey } from "../../../lib/project-settings";
import type { BackupModule } from "../types";
import {
	integrationNames,
	integrationTableSchema,
	localIntegrations,
	lostWarnings,
	remapIntegrations,
	restoredNames,
	tableFor,
} from "./integrationRefs";

/**
 * A project's settings (#1100), as stored. Several name integrations (the AI
 * agent's connection and MCP servers, the telemetry destinations); they go
 * through the integration table like any other reference, and one that doesn't
 * resolve is cleared, which is the setting's default (none).
 *
 * The subdomain is the project's address on this instance, unique across
 * projects. It is restored only when the new project has none and no other
 * project holds it; otherwise it is skipped and the restore says so. A setting
 * this instance doesn't know, or a value it would refuse, is skipped too. The
 * connection test a save runs is not: a template's integrations are blank.
 */

const SUBDOMAIN = "settings.routing.subdomain";

const schema = z.object({
	settings: z.array(z.object({ key: z.string().min(1), value: z.string() })),
	integrations: integrationTableSchema,
});
type Section = z.infer<typeof schema>;

/** a value as a list, since `settings.ai.agentMcpIntegrations` holds several ids */
const remapValue = (value: string, lookup: (v: string) => string | undefined) =>
	remapIntegrations(value.split(","), lookup).filter(Boolean).join(",");

/** what the upsert path would store, or undefined to skip */
function accepted(key: string, value: string) {
	const spec = projectSettingsKeySchemaMap[key as ProjectSettingsKeyType];
	if (!spec) return undefined;
	const stored = value || spec.defaultValue;
	return stored === spec.defaultValue || spec.schema.safeParse(stored).success ? stored : undefined;
}

/** "own": the caller gave the new project a subdomain already, which stands; "taken": another project holds it */
async function subdomainClash(projectId: string, value: string, tx: DbTransactionType) {
	const rows = await tx
		.select({ projectId: projectSettingsEntity.projectId, value: projectSettingsEntity.value })
		.from(projectSettingsEntity)
		.where(and(eq(projectSettingsEntity.key, SUBDOMAIN), ne(projectSettingsEntity.value, "")));
	if (rows.some((r) => r.projectId === projectId)) return "own";
	return rows.some((r) => r.value === value) ? "taken" : undefined;
}

export const projectSettingsModule: BackupModule<Section> = {
	name: "projectSettings",
	version: 1,
	minSupported: 1,
	upgrades: {},
	dependsOn: ["integrations"],
	schema,

	inspect({ settings, integrations }, read) {
		return lostWarnings(
			"Project settings",
			settings.map((s) => ({ where: s.key, value: s.value.split(",") })),
			integrations,
			restoredNames(read),
			"They are cleared; choose them again in Project Settings.",
		);
	},

	async export({ projectId }) {
		return await db.transaction(async (tx) => {
			const rows = await tx
				.select({ key: projectSettingsEntity.key, value: projectSettingsEntity.value })
				.from(projectSettingsEntity)
				.where(eq(projectSettingsEntity.projectId, projectId));
			const settings = rows.map((r) => ({ key: r.key, value: r.value }));
			const names = await integrationNames(projectId, tx);
			return {
				data: {
					settings,
					integrations: tableFor(
						settings.map((s) => s.value.split(",")),
						names,
					),
				},
			};
		});
	},

	async import({ tx, projectId, ids, afterCommit, warn }, { settings, integrations }) {
		const lookup = localIntegrations(integrations, ids);
		for (const { key, value: raw } of settings) {
			const value = accepted(key, remapValue(raw, lookup));
			if (value === undefined) continue;
			const clash = key === SUBDOMAIN && value && (await subdomainClash(projectId, value, tx));
			if (clash === "taken")
				warn(
					`The subdomain "${value}" is already used by another project here, so the restored project has none. Set one in Project Settings.`,
				);
			if (clash) continue;
			await upsertProjectSettingKey(projectId, key, value, tx);
		}
		// the compiler and the settings cache hold them in memory, as after a project create
		afterCommit(async () => {
			await deleteCacheKey(constructProjectSettingCacheKey(projectId));
			await publishMessage(CHAN_ON_PROJECT_SETTING_CHANGE, projectId);
		}, "The restored project settings may not reach the workers until a setting is saved once.");
	},
};
