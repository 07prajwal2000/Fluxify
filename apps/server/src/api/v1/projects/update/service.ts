import type { z } from "zod";
import { db } from "../../../../db";
import { ConflictError } from "../../../../errors/conflictError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { audit, bodyFields, forgetProject } from "../../../../modules/audit";
import type { requestBodySchema, responseSchema } from "./dto";
import { getProjectByIdName, updateProject } from "./repository";

export default async function handleRequest(
	id: string,
	body: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
	const data = await db.transaction(async (tx) => {
		const existingProjects = await getProjectByIdName(id, body.name ?? "", tx);
		let conflict = false,
			projectExist = false;
		for (const project of existingProjects) {
			if (project.id !== id) {
				conflict = true;
			} else {
				projectExist = true;
			}
		}
		if (!existingProjects || existingProjects.length === 0 || !projectExist) {
			throw new NotFoundError("Project not found");
		}
		if (conflict) {
			throw new ConflictError("Project name already exists");
		}
		const updated = await updateProject({
			id,
			...body,
		});
		await audit.record({
			projectId: id,
			resourceType: "project",
			resourceId: id,
			action: "update",
			changedFields: bodyFields(body),
			// the new name, not the one the cache still holds
			project: { name: body.name },
		});
		return updated;
	});
	forgetProject(id);

	if (!data) throw new ServerError("Something went wrong");

	return {
		...data,
		name: data.name ?? "",
		hidden: data.hidden ?? false,
		createdAt: data.createdAt.toISOString(),
		updatedAt: data.updatedAt.toISOString(),
	};
}
