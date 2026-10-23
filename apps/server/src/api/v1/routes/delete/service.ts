import type { z } from "zod";
import { db } from "../../../../db";
import { CHAN_ON_ROUTE_CHANGE, publishMessage } from "../../../../db/redis";
import type { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { canAccessProject } from "../../../../lib/acl";
import { audit } from "../../../../modules/audit";
import { dropRoute } from "../../../../modules/compiler/service";
import type { responseSchema } from "./dto";
import { deleteRoute, findRouteById } from "./repository";

export default async function handleRequest(
	id: string,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
	let projectId: string | undefined;
	await db.transaction(async (tx) => {
		const existingRoute = await findRouteById(id, tx);
		if (!existingRoute) {
			throw new NotFoundError("Route not found");
		}
		const canAccess = canAccessProject(acl, existingRoute.projectId!, "creator");
		if (!canAccess) {
			throw new ForbiddenError();
		}
		projectId = existingRoute.projectId!;
		await deleteRoute(id, tx);
		await audit.record({
			projectId,
			resourceType: "route",
			resourceId: id,
			action: "delete",
			changedFields: [],
		});
	});
	// the compiler resolves a route's project from the database, so once the row
	// is gone it can no longer work out which artifact key to drop — workers would
	// keep serving the deleted route from KV. Drop it here, where we still know.
	if (projectId) {
		await dropRoute(projectId, id);
		const { invalidateOpenApiCache } = await import("../openapi/service");
		await invalidateOpenApiCache(projectId);
	}
	await publishMessage(CHAN_ON_ROUTE_CHANGE, id);
	return "";
}
