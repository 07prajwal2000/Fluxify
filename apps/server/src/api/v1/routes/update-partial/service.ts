import { z } from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import { db } from "../../../../db";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ConflictError } from "../../../../errors/conflictError";
import { getRouteByNameOrPath, updateRoute } from "../update/repository";
import { publishMessage, CHAN_ON_ROUTE_CHANGE } from "../../../../db/redis";
import { ServerError } from "../../../../errors/serverError";
import { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { patchRouteConfig } from "../routeConfigRepository";
import { BadRequestError } from "../../../../errors/badRequestError";
import { normalizeParamsSchema, validateRouteSchemas } from "../schema-validator";

type RouteSchemas = {
	path: string | null;
	bodySchema?: any;
	querySchema?: any;
	paramsSchema?: any;
};

const SCHEMA_FIELDS = ["bodySchema", "querySchema", "paramsSchema"] as const;

/**
 * Patches the request/response schemas onto the route being updated.
 *
 * They cannot be validated in the DTO like every other field: a schema is only
 * correct relative to the path it validates, and a patch may not carry one. So
 * the incoming fields are merged over what is stored and the *result* is
 * checked — which also catches the case where the path is edited down to no
 * `:params` and the caller leaves the old `paramsSchema` behind.
 *
 * Skipped entirely when the patch touches neither the path nor a schema, so
 * toggling `active` on a route whose schemas predate this check still works.
 */
function applySchemas(
	route: RouteSchemas,
	data: z.infer<typeof requestBodySchema>,
) {
	const touched = SCHEMA_FIELDS.some((field) => field in data);
	if (!touched && data.path === undefined) return;

	const merged = normalizeParamsSchema({
		path: route.path ?? "",
		bodySchema: field(data, "bodySchema", route),
		querySchema: field(data, "querySchema", route),
		paramsSchema: field(data, "paramsSchema", route),
	});
	const result = validateRouteSchemas(merged);
	if (!result.success) {
		throw new BadRequestError(
			result.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
		);
	}
	for (const name of SCHEMA_FIELDS) route[name] = merged[name] ?? null;
}

/** The patched value of one schema field, or the stored one when omitted. An
 *  explicit null clears it, so absence — not falsiness — is what falls back. */
function field(
	data: z.infer<typeof requestBodySchema>,
	name: (typeof SCHEMA_FIELDS)[number],
	route: RouteSchemas,
) {
	return name in data ? data[name] : route[name];
}

export default async function handleRequest(
  id: string,
  data: z.infer<typeof requestBodySchema>,
  acl: AuthACL[] = []
): Promise<z.infer<typeof responseSchema>> {
  const result = await db.transaction(async (tx) => {
    const existingRoute = await getRouteByNameOrPath(
      id,
      data.name ?? "",
      data.path ?? "",
      data.method ?? ("NONE" as any),
      tx
    );
    if (!existingRoute) {
      throw new NotFoundError("Route not found");
    }
    const hasAccess = acl.some(
      (entry) =>
        entry.projectId === existingRoute.projectId || entry.projectId === "*"
    );
    if (!hasAccess) {
      throw new ForbiddenError();
    }
    if (existingRoute.id !== id) {
      throw new ConflictError("Route already exists");
    }
    const patchedRoute = existingRoute;
    if (data.name) patchedRoute.name = data.name;
    if (data.path) patchedRoute.path = data.path;
    if (data.method) patchedRoute.method = data.method;
    if (data.active !== undefined) patchedRoute.active = data.active;
		if (data.timeoutSeconds !== undefined) {
			patchedRoute.timeoutSeconds = data.timeoutSeconds;
		}
		if (data.tracingEnabled !== undefined) {
			patchedRoute.tracingEnabled = data.tracingEnabled;
		}
		if (data.recordExecution !== undefined) {
			patchedRoute.recordExecution = data.recordExecution;
		}
		if (data.acceptedContentTypes !== undefined) {
			await patchRouteConfig(
				id,
				existingRoute.projectId,
				{ acceptedContentTypes: data.acceptedContentTypes },
				tx,
			);
		}
		applySchemas(patchedRoute, data);
    return await updateRoute(
      {
        ...patchedRoute,
        id,
        updatedAt: new Date(),
      } as any,
      tx
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
