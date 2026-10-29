import type { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { buildRouteBundle } from "../../../../modules/routeTransfer/export";
import { getRouteById } from "../get-by-id/repository";

export default async function handleRequest(id: string, includeTests: boolean, acl: AuthACL[]) {
	const route = await getRouteById(id);
	if (!route) throw new NotFoundError(`no route found with id: ${id}`);
	if (!acl.some((a) => a.projectId === route.projectId || a.projectId === "*")) {
		throw new ForbiddenError();
	}
	return await buildRouteBundle(id, includeTests);
}
