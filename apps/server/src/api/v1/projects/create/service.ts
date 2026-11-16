import { generateID, toSlug } from "@fluxify/lib";
import type { z } from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { CHAN_ON_PROJECT_SETTING_CHANGE, publishMessage } from "../../../../db/redis";
import { BadRequestError } from "../../../../errors/badRequestError";
import { ConflictError } from "../../../../errors/conflictError";
import { ServerError } from "../../../../errors/serverError";
import { auditLogsDefaultEnabled } from "../../../../lib/edition";
import { audit, bodyFields } from "../../../../modules/audit";
import { requestProjectConfigPublish } from "../../../../modules/compiler/publisher";
import { createDevToken } from "../settings/dev-token/create";
import { upsertProjectSettingKey } from "../settings/keys/upsert/repository";
import { addProjectMember } from "../settings/members/repository";
import type { requestBodySchema, responseSchema } from "./dto";
import { checkProjectExists, createProject, isSlugTaken } from "./repository";

type Body = z.infer<typeof requestBodySchema>;

/**
 * Every row a new project starts with, inside the caller's transaction: the
 * project, its dev token, members, settings and the audit setting. A restore
 * (#1104) creates its project through here too, so it gets the same rows.
 * The audit entry is the caller's: `recordProjectCreated`, as its last step.
 */
export async function insertNewProject(data: Body, tx: DbTransactionType) {
	const { members, settings, ...project } = data;
	if (await checkProjectExists(project.name, tx))
		throw new ConflictError(`Project already exists with '${project.name}' name`);
	const slug = project.slug || toSlug(project.name);
	if (!slug)
		throw new BadRequestError("Give the project a slug; its name has no letters or digits");
	if (await isSlugTaken(slug, tx))
		throw new ConflictError(`Project already exists with '${slug}' slug`);

	const projectId = await createProject({ ...project, slug, id: generateID() }, tx);
	if (!projectId) throw new ServerError("Something went wrong while creating project");

	await createDevToken(projectId, tx);
	for (const member of members ?? []) {
		await addProjectMember(projectId, member.userId, member.role, tx);
	}
	for (const [key, value] of Object.entries(settings ?? {})) {
		if (value === undefined) continue;
		await upsertProjectSettingKey(projectId, key, value, tx);
	}

	// On where the licence allows audit logs; an admin can turn it off (#833).
	// Off is the absence of the row, the same as a project from before the feature.
	const auditOn = auditLogsDefaultEnabled();
	if (auditOn) await upsertProjectSettingKey(projectId, "auditLogs.enabled", "true", tx);
	return { projectId, name: project.name, slug, auditOn };
}

/** the audit entry for a project created inside a transaction; nothing committed yet to look up */
export function recordProjectCreated(
	created: Awaited<ReturnType<typeof insertNewProject>>,
	action: "create" | "restore",
	changedFields: string[],
) {
	return audit.record({
		projectId: created.projectId,
		resourceType: "project",
		resourceId: created.projectId,
		action,
		changedFields,
		project: { name: created.name, slug: created.slug, enabled: created.auditOn },
	});
}

/** after the commit: what workers need to know about a new project */
export async function announceNewProject(id: string, settingsChanged: boolean) {
	// the dev config carries the token's hash, and none exists for a new project yet
	await requestProjectConfigPublish(id, "project created");
	// The compiler holds settings in memory; without this a subdomain given at
	// creation never reaches the workers until the next settings save.
	if (settingsChanged) await publishMessage(CHAN_ON_PROJECT_SETTING_CHANGE, id);
}

export default async function handleRequest(data: Body): Promise<z.infer<typeof responseSchema>> {
	// Members and settings ride in the same transaction as the insert: a project
	// that exists but is missing the access grants it was created with is worse
	// than no project at all, since only a system admin could then repair it.
	const id = await db.transaction(async (tx) => {
		const created = await insertNewProject(data, tx);
		await recordProjectCreated(created, "create", bodyFields(data));
		return created.projectId;
	});
	await announceNewProject(id, !!data.settings && Object.keys(data.settings).length > 0);
	return { id };
}
