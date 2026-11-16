import { logger } from "@fluxify/common";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "../../db";
import { projectSettingsEntity } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { ConflictError } from "../../errors/conflictError";
import { canRunStorageBackups, currentEntitlement } from "../../lib/edition";
import { audit } from "../audit";
import { hasRunning, insertBackup, lastStorageRun, lockProjectBackups } from "./history";
import { isDue } from "./prefix";
import { runBackup } from "./run";
import { readSchedule, SCHEDULE_KEYS } from "./schedule";
import { storageDestination } from "./storageDestination";

/**
 * Starting backups to object storage (#1106): "Back up now" and the daily tick.
 * Both go through `startStorageBackup`, which checks and records the run under
 * a per-project lock, so two admin replicas (or a click and the tick) never run
 * the same project at once.
 */

type Start = { userId: string | null } & ({ manual: true } | { manual: false; now: Date });

/**
 * Records an object storage backup and starts it. Returns null when nothing
 * started: for the tick, a project that is running, not due, or not set up;
 * "Back up now" throws instead, saying why. `done` settles when the run has.
 */
export async function startStorageBackup(projectId: string, start: Start) {
	const { schedule, readme } = await readSchedule(projectId);
	const { integrationId, prefix } = schedule;
	if (!integrationId || !prefix) {
		if (start.manual)
			throw new BadRequestError(
				"Choose an Object Storage integration and a prefix, and save them, before backing up.",
			);
		return null;
	}
	const row = await db.transaction(async (tx) => {
		await lockProjectBackups(tx, projectId);
		if (await hasRunning(projectId, tx)) {
			if (start.manual)
				throw new ConflictError(
					"A backup of this project is already running. Wait for it to finish.",
				);
			return null;
		}
		if (!start.manual) {
			const last = await lastStorageRun(projectId, true, tx);
			if (!isDue(last?.createdAt ?? null, schedule.interval, start.now)) return null;
		}
		const created = await insertBackup(
			{
				projectId,
				type: "object_storage",
				mode: "backup",
				sections: schedule.sections,
				createdBy: start.userId,
			},
			tx,
		);
		if (start.manual)
			await audit.record({
				projectId,
				resourceType: "project_backup",
				resourceId: created.id,
				action: "create",
				changedFields: ["type", "sections"],
			});
		return created;
	});
	if (!row) return null;
	const options = {
		includeVersionHistory: schedule.includeVersionHistory,
		includeAppConfigValues: schedule.includeAppConfigValues,
	};
	const destination = storageDestination(row, {
		integrationId,
		prefix,
		retention: schedule.retention,
	});
	return { id: row.id, done: runBackup(row, { options, readme }, destination) };
}

const BATCH = 50;

/**
 * The daily tick: backs up every enabled project whose last successful object
 * storage backup is older than its interval. Idempotent (a second tick the same
 * day finds nothing due) and catches up after downtime (a missed day is simply
 * due). Without the license nothing runs, and the settings are kept.
 *
 * ponytail: runs one project at a time, so one archive is in memory at once and
 * a long list takes a while. A tick redelivered meanwhile skips the running and
 * the done ones; spread runs over replicas if the list gets long.
 */
export async function runScheduledBackups(now = new Date(), license = currentEntitlement()) {
	if (!canRunStorageBackups(license)) {
		logger.info("[backup] scheduled backups to object storage skipped: not licensed", "BACKUP");
		return { started: 0 };
	}
	let started = 0;
	let after = "";
	for (;;) {
		const batch = await db
			.select({ projectId: projectSettingsEntity.projectId })
			.from(projectSettingsEntity)
			.where(
				and(
					eq(projectSettingsEntity.key, SCHEDULE_KEYS.enabled),
					eq(projectSettingsEntity.value, "true"),
					gt(projectSettingsEntity.projectId, after),
				),
			)
			.orderBy(asc(projectSettingsEntity.projectId))
			.limit(BATCH);
		for (const { projectId } of batch) {
			if (!projectId) continue;
			try {
				const run = await startStorageBackup(projectId, { userId: null, manual: false, now });
				if (!run) continue;
				started++;
				await run.done;
			} catch (error) {
				logger.error(`[backup] scheduled backup of ${projectId}: ${String(error)}`, "BACKUP");
			}
		}
		if (batch.length < BATCH) break;
		after = batch[batch.length - 1]!.projectId ?? after;
	}
	return { started };
}
