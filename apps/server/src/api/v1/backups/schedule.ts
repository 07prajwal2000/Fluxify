import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../../../db";
import { projectsEntity } from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { assertCanRunStorageBackups, assertCanUse } from "../../../lib/edition";
import { audit } from "../../../modules/audit";
import { lastStorageRun } from "../../../modules/projectBackup/history";
import { BACKUP_MODULES } from "../../../modules/projectBackup/modules";
import { defaultPrefix } from "../../../modules/projectBackup/prefix";
import { readSchedule, writeSchedule } from "../../../modules/projectBackup/schedule";
import { startStorageBackup } from "../../../modules/projectBackup/storageRun";
import { getIntegrationById } from "../integrations/test-existing-connection/repository";
import type { scheduleBodySchema } from "./dto";
import { view } from "./service";

/**
 * Backups to object storage (#1106, EE). Reading stays open on every edition,
 * so a downgraded project still shows its settings (locked) and its history.
 */

type Body = z.infer<typeof scheduleBodySchema>;

export async function getSchedule(projectId: string) {
	const [{ schedule }, [project], last] = await Promise.all([
		readSchedule(projectId),
		db
			.select({ slug: projectsEntity.slug })
			.from(projectsEntity)
			.where(eq(projectsEntity.id, projectId)),
		lastStorageRun(projectId),
	]);
	return {
		schedule,
		defaultPrefix: defaultPrefix(project?.slug ?? projectId),
		lastRun: last ? view(last, { email: null, name: null }) : null,
	};
}

/** saves every field at once; licensed, a real Object Storage integration, known sections */
export async function saveSchedule(projectId: string, body: Body) {
	assertCanUse("objectStorageBackups");
	const integration = await getIntegrationById(projectId, body.integrationId);
	if (!integration || integration.group !== "storage")
		throw new BadRequestError("Choose an Object Storage integration of this project.");
	const unknown = body.sections.find((name) => !BACKUP_MODULES.some((m) => m.name === name));
	if (unknown) throw new BadRequestError(`There is no "${unknown}" section to back up.`);

	await db.transaction(async (tx) => {
		await writeSchedule(projectId, { ...body, sections: [...new Set(body.sections)] }, tx);
		await audit.record({
			projectId,
			resourceType: "project",
			resourceId: projectId,
			action: "update",
			changedFields: ["backupSchedule"],
		});
	});
	return getSchedule(projectId);
}

/** "Back up now": uploads with the saved settings, enabled or not */
export async function backupNow(projectId: string, userId: string | null) {
	assertCanRunStorageBackups();
	const run = await startStorageBackup(projectId, { userId, manual: true });
	// a manual start throws instead of returning null
	return run!;
}
