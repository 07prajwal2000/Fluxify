import { generateID } from "@fluxify/lib";
import type z from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { CHAN_ON_ROUTE_CHANGE, publishMessage } from "../../../../db/redis";
import type { HttpMethod } from "../../../../db/schema";
import { ConflictError } from "../../../../errors/conflictError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { DEFAULT_CONTENT_TYPES } from "../../../../lib/routeConfig";
import { patchRouteConfig } from "../routeConfigRepository";
import type { requestBodySchema, responseSchema } from "./dto";
import { checkProjectExist, checkRouteExist, createDependency, createRoute } from "./repository";

/**
 * `outer` joins a transaction already in progress, so the ops bus can create a
 * route and its canvas atomically. The change signal is then the caller's to
 * publish once that transaction commits.
 */
export default async function handleRequest(
	userId: string,
	data: z.infer<typeof requestBodySchema>,
	outer?: DbTransactionType,
	/** Caller-chosen id. The ops bus uses it so a route the harness planned keeps
	 *  the id its canvas output already points at; HTTP never passes one. */
	presetId?: string,
	/** false when the caller is about to write its own canvas for this route
	 *  (e.g. a template or AI-generated graph with its own entrypoint/error
	 *  handler) — seeding defaults too would collide with it. */
	seedDefaultBlocks = true,
): Promise<z.infer<typeof responseSchema>> {
	const result = await (outer ?? db).transaction(async (tx) => {
		const projectExist = await checkProjectExist(data.projectId, tx);
		if (!projectExist) {
			throw new NotFoundError(`project with id ${data.projectId} does not exist`);
		}
		const existingRoute = await checkRouteExist(
			data.name,
			data.path,
			data.method as HttpMethod,
			tx,
		);
		if (existingRoute) {
			throw new ConflictError(`route with name or path already exist`);
		}
		const id = presetId ?? generateID();
		const { acceptedContentTypes, ...route } = data;
		const newRouteId = await createRoute({ ...route, id, createdBy: userId }, tx);
		if (seedDefaultBlocks) await createDependency(newRouteId, tx);
		await patchRouteConfig(
			newRouteId,
			data.projectId,
			{ acceptedContentTypes: acceptedContentTypes ?? DEFAULT_CONTENT_TYPES },
			tx,
		);
		return {
			id: newRouteId,
		};
	});
	if (!outer) await publishMessage(CHAN_ON_ROUTE_CHANGE, result.id);
	return result;
}
