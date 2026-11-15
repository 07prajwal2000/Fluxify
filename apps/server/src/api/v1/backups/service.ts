import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../../../db";
import { projectsEntity } from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { ConflictError } from "../../../errors/conflictError";
import { NotFoundError } from "../../../errors/notFoundError";
import { audit } from "../../../modules/audit";
import {
	ARCHIVE_RETENTION_DAYS,
	expiresAt,
	getArchive,
} from "../../../modules/projectBackup/archives";
import {
	findBackup,
	hasRunning,
	insertBackup,
	listBackups,
} from "../../../modules/projectBackup/history";
import { BACKUP_MODULES } from "../../../modules/projectBackup/modules";
import { runBackup } from "../../../modules/projectBackup/run";
import { upsertProjectSettingKey } from "../projects/settings/keys/upsert/repository";
import type { startBodySchema } from "./dto";

type Body = z.infer<typeof startBodySchema>;
type Row = NonNullable<Awaited<ReturnType<typeof findBackup>>>;

/** the sections this instance can back up, from the registry, never a list kept here */
export const sections = () => ({
	sections: BACKUP_MODULES.map(({ name, dependsOn }) => ({ name, dependsOn })),
});

export const README_KEY = "settings.backup.readme";

const downloadable = (row: Row) =>
	row.type === "manual" && row.status === "succeeded" && row.destinationKey !== null;

const view = (row: Row, by: { email: string | null; name: string | null }) => ({
	id: row.id,
	type: row.type,
	mode: row.mode,
	sections: row.sections,
	formatVersions: row.formatVersions,
	release: row.release,
	sizeBytes: row.sizeBytes,
	status: row.status,
	error: row.error,
	downloadable: downloadable(row),
	expiresAt: downloadable(row) && row.finishedAt ? expiresAt(row.finishedAt) : null,
	createdBy: by.email ? { email: by.email, name: by.name } : null,
	createdAt: row.createdAt,
	finishedAt: row.finishedAt,
});

export async function list(projectId: string) {
	const rows = await listBackups(projectId);
	return {
		backups: rows.map((r) => view(r.backup, { email: r.createdByEmail, name: r.createdByName })),
		retentionDays: ARCHIVE_RETENTION_DAYS,
	};
}

/**
 * Records a manual backup and starts it. The run goes on after the response, on
 * this admin process; the row says how it ended. `done` settles when it has,
 * which only a test waits for.
 */
export async function start(projectId: string, userId: string | null, body: Body) {
	const unknown = body.sections.find((name) => !BACKUP_MODULES.some((m) => m.name === name));
	if (unknown) throw new BadRequestError(`There is no "${unknown}" section to back up.`);
	if (await hasRunning(projectId))
		throw new ConflictError("A backup of this project is already running. Wait for it to finish.");

	const options = {
		includeVersionHistory: body.includeVersionHistory,
		// a template never carries values; the engine forces it, the row says so too
		includeAppConfigValues: body.mode === "backup" && body.includeAppConfigValues,
	};
	const row = await db.transaction(async (tx) => {
		const created = await insertBackup(
			{
				projectId,
				type: "manual",
				mode: body.mode,
				sections: [...new Set(body.sections)],
				createdBy: userId,
			},
			tx,
		);
		// the audit entry is the last step: a failed publish rolls the row back
		await audit.record({
			projectId,
			resourceType: "project_backup",
			resourceId: created.id,
			action: "create",
			changedFields: ["mode", "sections", ...(body.readme === undefined ? [] : ["readme"])],
		});
		return created;
	});
	// remembered for the next backup, and for a scheduled one (#1106)
	if (body.readme !== undefined) await upsertProjectSettingKey(projectId, README_KEY, body.readme);
	return { id: row.id, done: runBackup(row, { options, readme: body.readme }) };
}

/** the archive's bytes and the name to save it as; refused once it has expired */
export async function download(projectId: string, id: string) {
	const row = await findBackup(projectId, id);
	if (!row || row.type !== "manual") throw new NotFoundError("Backup not found");
	if (row.status !== "succeeded")
		throw new ConflictError(
			row.status === "running"
				? "This backup is still running."
				: "This backup failed; there is nothing to download.",
		);
	if (!row.destinationKey)
		throw new NotFoundError(
			`This backup has expired: archives are kept for ${ARCHIVE_RETENTION_DAYS} days. Start a new one.`,
		);
	const bytes = await getArchive(row.destinationKey);
	if (!bytes)
		throw new NotFoundError("This backup's archive is no longer stored. Start a new one.");

	const [project] = await db
		.select({ slug: projectsEntity.slug })
		.from(projectsEntity)
		.where(eq(projectsEntity.id, projectId));
	await audit.record({
		projectId,
		resourceType: "project_backup",
		resourceId: id,
		action: "download",
		changedFields: [],
	});
	const stamp = row.createdAt.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
	const slug = (project?.slug ?? projectId).replace(/[^\w.-]/g, "_");
	return { bytes, filename: `${slug}-${row.mode}-${stamp}.tar.gz` };
}
