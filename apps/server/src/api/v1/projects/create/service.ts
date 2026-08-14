import { z } from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import { db } from "../../../../db";
import { ConflictError } from "../../../../errors/conflictError";
import { checkProjectExists, createProject } from "./repository";
import { addProjectMember } from "../settings/members/repository";
import { upsertProjectSettingKey } from "../settings/keys/upsert/repository";
import { ServerError } from "../../../../errors/serverError";
import { generateID } from "@fluxify/lib";

export default async function handleRequest(
	data: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
	const { members, settings, ...project } = data;

	// Members and settings ride in the same transaction as the insert: a project
	// that exists but is missing the access grants it was created with is worse
	// than no project at all, since only a system admin could then repair it.
	const id = await db.transaction(async (tx) => {
		const exist = await checkProjectExists(project.name, tx);
		if (exist)
			throw new ConflictError(
				`Project already exists with '${project.name}' name`,
			);

		const projectId = await createProject(
			{ ...project, id: generateID() },
			tx,
		);
		if (!projectId) return "";

		for (const member of members ?? []) {
			await addProjectMember(projectId, member.userId, member.role, tx);
		}

		for (const [key, value] of Object.entries(settings ?? {})) {
			if (value === undefined) continue;
			await upsertProjectSettingKey(projectId, key, value, tx);
		}

		return projectId;
	});

	if (!id) throw new ServerError("Something went wrong while creating project");
	return { id };
}
