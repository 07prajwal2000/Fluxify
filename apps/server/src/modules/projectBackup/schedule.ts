import { and, eq, inArray } from "drizzle-orm";
import { upsertProjectSettingKey } from "../../api/v1/projects/settings/keys/upsert/repository";
import { type DbTransactionType, db } from "../../db";
import { projectSettingsEntity } from "../../db/schema";
import { BACKUP_MODULES } from "./modules";
import { BACKUP_INTERVALS, type BackupInterval, MAX_BACKUP_RETENTION } from "./prefix";

/**
 * A project's backups to object storage (#1106), kept as project settings so
 * a restore carries them (switched off, see `resources/projectSettings.ts`).
 * The resources and options are shared with the manual backup form.
 */

export const SCHEDULE_KEYS = {
	integrationId: "settings.backup.storage.integrationId",
	prefix: "settings.backup.storage.prefix",
	interval: "settings.backup.storage.interval",
	retention: "settings.backup.storage.retention",
	enabled: "settings.backup.storage.enabled",
	sections: "settings.backup.sections",
	includeVersionHistory: "settings.backup.versionHistory",
	includeAppConfigValues: "settings.backup.appConfigValues",
} as const;
const README_KEY = "settings.backup.readme";

export type BackupSchedule = {
	integrationId: string | null;
	/** empty until chosen; the portal suggests the project's slug */
	prefix: string;
	interval: BackupInterval;
	retention: number;
	enabled: boolean;
	sections: string[];
	includeVersionHistory: boolean;
	includeAppConfigValues: boolean;
};

/** a stored list, minus any section this instance no longer has; empty means all */
const sectionsOf = (value: string | undefined) => {
	const known = BACKUP_MODULES.map((m) => m.name);
	const picked = (value ?? "").split(",").filter((n) => known.includes(n));
	return picked.length ? picked : known;
};

const retentionOf = (value: string | undefined) => {
	const n = Number(value);
	return Number.isInteger(n) && n >= 1 && n <= MAX_BACKUP_RETENTION ? n : 7;
};

/** the schedule, plus the README the last backup used (a scheduled one reuses it) */
export async function readSchedule(projectId: string, tx: DbTransactionType | typeof db = db) {
	const rows = await tx
		.select({ key: projectSettingsEntity.key, value: projectSettingsEntity.value })
		.from(projectSettingsEntity)
		.where(
			and(
				eq(projectSettingsEntity.projectId, projectId),
				inArray(projectSettingsEntity.key, [...Object.values(SCHEDULE_KEYS), README_KEY]),
			),
		);
	const get = (key: string) => rows.find((r) => r.key === key)?.value;
	const interval = get(SCHEDULE_KEYS.interval) as BackupInterval;
	const schedule: BackupSchedule = {
		integrationId: get(SCHEDULE_KEYS.integrationId) || null,
		prefix: get(SCHEDULE_KEYS.prefix) ?? "",
		interval: BACKUP_INTERVALS.includes(interval) ? interval : "daily",
		retention: retentionOf(get(SCHEDULE_KEYS.retention)),
		enabled: get(SCHEDULE_KEYS.enabled) === "true",
		sections: sectionsOf(get(SCHEDULE_KEYS.sections)),
		includeVersionHistory: get(SCHEDULE_KEYS.includeVersionHistory) === "true",
		includeAppConfigValues: get(SCHEDULE_KEYS.includeAppConfigValues) === "true",
	};
	return { schedule, readme: get(README_KEY) || undefined };
}

/** writes every key; the caller has checked the license, the integration and the prefix */
export async function writeSchedule(projectId: string, s: BackupSchedule, tx: DbTransactionType) {
	const values: Record<keyof BackupSchedule, string> = {
		integrationId: s.integrationId ?? "",
		prefix: s.prefix,
		interval: s.interval,
		retention: String(s.retention),
		enabled: String(s.enabled),
		sections: s.sections.join(","),
		includeVersionHistory: String(s.includeVersionHistory),
		includeAppConfigValues: String(s.includeAppConfigValues),
	};
	for (const [field, key] of Object.entries(SCHEDULE_KEYS))
		await upsertProjectSettingKey(projectId, key, values[field as keyof BackupSchedule], tx);
}
