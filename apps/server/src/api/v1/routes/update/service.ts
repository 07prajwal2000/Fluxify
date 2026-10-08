import type { z } from "zod";
import { db } from "../../../../db";
import { CHAN_ON_ROUTE_CHANGE, publishMessage } from "../../../../db/redis";
import type { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { canAccessProject } from "../../../../lib/acl";
import { patchRouteConfig } from "../routeConfigRepository";
import { routeConflictError } from "../routeConflict";
import { normalizeParamsSchema } from "../schema-validator";
import type { requestBodySchema, responseSchema } from "./dto";
import { findRouteConflict, getRouteById, updateRoute } from "./repository";

export default async function handleRequest(
	id: string,
	data: z.infer<typeof requestBodySchema>,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
	const result = await db.transaction(async (tx) => {
		const existingRoute = await getRouteById(id, tx);
		if (!existingRoute) {
			throw new NotFoundError("Route not found");
		}
		if (!canAccessProject(acl, existingRoute.projectId ?? "", "creator")) {
			throw new ForbiddenError();
		}
		const wanted = { ...data, projectId: existingRoute.projectId ?? "" };
		const clash = await findRouteConflict(wanted, id, tx);
		if (clash) throw routeConflictError(clash, wanted);
		const { acceptedContentTypes, ...route } = data;
		if (acceptedContentTypes !== undefined) {
			await patchRouteConfig(id, existingRoute.projectId, { acceptedContentTypes }, tx);
		}
		// An undefined field is skipped by the update statement, so an omitted
		// paramsSchema would leave the previous one behind. Normalise so a path
		// that no longer declares `:params` writes an explicit null instead.
		return await updateRoute(
			{
				id,
				...normalizeParamsSchema(route),
			},
			tx,
		);
	});
	if (!result) {
		throw new ServerError("Something went wrong while updating the route");
	}
	await publishMessage(CHAN_ON_ROUTE_CHANGE, id);
	return {
		id: result.id,
		name: result.name!,
		path: result.path!,
		method: result.method!,
		timeoutSeconds: result.timeoutSeconds,
		createdAt: result.createdAt.toISOString(),
		updatedAt: result.updatedAt.toISOString(),
	};
}
