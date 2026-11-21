import { and, eq, inArray, ne } from "drizzle-orm";
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
import { GIT_KEY_PREFIX, GIT_KEYS } from "../gitSettings";
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
import { integrationUses } from "./rollback";

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
/** the last backup's README (#1103) travels in the archive itself, not as a setting of the copy */
const NOT_BACKED_UP = "settings.backup.readme";
/**
 * Backups to object storage (#1106) restore switched off and without a prefix:
 * a copy writing to (and pruning) the source's prefix would delete the source's
 * backups. The integration, interval and retention are kept.
 */
const SCHEDULE_OFF: Record<string, string> = {
	"settings.backup.storage.enabled": "false",
	"settings.backup.storage.prefix": "",
};
export const SCHEDULE_OFF_WARNING =
	"Scheduled backups are off in the restored project; choose a prefix and turn them on.";
/** Commits to git (#1150) are never restored: a copy would push to the source's branch. */
const gitSetting = (key: string) => key.startsWith(GIT_KEY_PREFIX);
export const GIT_CLEARED_WARNING =
	"Commits to git are not set up in the restored project; set the repository in Project Settings > Backup.";
/**
 * What a rollback (#1130) leaves as it is on the live project: its address, its
 * own backups to object storage (restoring them would switch them off) and git, and
 * audit logging, which a rollback must never turn off.
 */
const KEPT_ON_ROLLBACK = (key: string) =>
	key === SUBDOMAIN ||
	key === NOT_BACKED_UP ||
	key === "auditLogs.enabled" ||
	key.startsWith("settings.backup.storage.") ||
	gitSetting(key);

const scheduleWasOn = (settings: Section["settings"]) =>
	settings.some((s) => s.key === "settings.backup.storage.enabled" && s.value === "true");

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

	// an integration id reads as its name
	preview: ({ settings, integrations }) =>
		settings
			.filter((s) => s.key !== NOT_BACKED_UP)
			.map((s) => {
				const value = s.value
					.split(",")
					.map((v) => integrations[v] ?? v)
					.join(", ");
				return { name: s.key, summary: value, details: { Value: value || null } };
			}),

	inspect({ settings, integrations }, read) {
		const off = scheduleWasOn(settings) ? [SCHEDULE_OFF_WARNING] : [];
		if (settings.some((s) => s.key === GIT_KEYS.url && s.value)) off.push(GIT_CLEARED_WARNING);
		return [
			...off,
			...lostWarnings(
				"Project settings",
				settings.map((s) => ({ where: s.key, value: s.value.split(",") })),
				integrations,
				restoredNames(read),
				"They are cleared; choose them again in Project Settings.",
			),
		];
	},

	names: ({ settings }) => settings.map((s) => s.key).filter((key) => !KEPT_ON_ROLLBACK(key)),

	async existing(projectId, tx) {
		const rows = await tx
			.select({ key: projectSettingsEntity.key })
			.from(projectSettingsEntity)
			.where(eq(projectSettingsEntity.projectId, projectId));
		return new Map(rows.filter((r) => !KEPT_ON_ROLLBACK(r.key)).map((r) => [r.key, r.key]));
	},

	uses: ({ settings, integrations }) =>
		integrationUses(
			"Project settings",
			settings.map((s) => s.value.split(",")),
			integrations,
		),

	/** a setting the backup didn't have was at its default then: no row is the default */
	async prune({ tx, projectId }, stale) {
		if (!stale.length) return;
		await tx.delete(projectSettingsEntity).where(
			and(
				eq(projectSettingsEntity.projectId, projectId),
				inArray(
					projectSettingsEntity.key,
					stale.map((s) => s.name),
				),
			),
		);
	},

	async export({ projectId }) {
		return await db.transaction(async (tx) => {
			const rows = await tx
				.select({ key: projectSettingsEntity.key, value: projectSettingsEntity.value })
				.from(projectSettingsEntity)
				.where(eq(projectSettingsEntity.projectId, projectId));
			const settings = rows
				.filter((r) => r.key !== NOT_BACKED_UP)
				.map((r) => ({ key: r.key, value: r.value }));
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

	async import({ tx, projectId, ids, afterCommit, warn, target }, { settings, integrations }) {
		const lookup = localIntegrations(integrations, ids);
		for (const { key, value: raw } of settings) {
			if (gitSetting(key) || (target === "existing" && KEPT_ON_ROLLBACK(key))) continue;
			const value = accepted(key, SCHEDULE_OFF[key] ?? remapValue(raw, lookup));
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
