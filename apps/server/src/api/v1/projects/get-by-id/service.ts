import type { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { getProjectById } from "./repository";

export default async function handleRequest(
	id: string,
	acl: AuthACL[] = [],
	isSystemAdmin = false,
) {
	const project = await getProjectById(id);
	if (!project || project.hidden) {
		throw new NotFoundError("Project not found");
	}
	const hasAccess =
		isSystemAdmin || acl.some((a) => a.projectId === project.id || a.projectId === "*");
	if (!hasAccess) {
		throw new ForbiddenError("You do not have access to this project");
	}
	return {
		id: project.id,
		name: project.name ?? "",
		slug: project.slug,
		description: project.description,
		hidden: project.hidden ?? false,
		createdAt: project.createdAt.toISOString(),
		updatedAt: project.updatedAt.toISOString(),
	};
}
