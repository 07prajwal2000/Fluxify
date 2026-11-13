import { eq } from "drizzle-orm";
import { readRouteConfig } from "../../api/v1/routes/routeConfigRepository";
import { db } from "../../db";
import { integrationsEntity, middlewaresEntity, routesEntity } from "../../db/schema";
import { NotFoundError } from "../../errors/notFoundError";
import { getBlocks, getEdges } from "../canvas/repository";
import { listResponseSchemas } from "../responseSchemas/repository";
import { routeMiddlewareIds } from "../versions/snapshot";
import { ROUTE_BUNDLE_KIND, ROUTE_BUNDLE_VERSION, type RouteBundle } from "./bundle";
import { exportSuites, namesOf } from "./suites";

/** Reads a route into a bundle. The caller has already checked access. */
export async function buildRouteBundle(
	routeId: string,
	includeTests: boolean,
): Promise<RouteBundle> {
	const [route] = await db.select().from(routesEntity).where(eq(routesEntity.id, routeId));
	if (!route) throw new NotFoundError(`no route found with id: ${routeId}`);

	const parent = { type: "route", id: routeId } as const;
	const [blocks, edges, schemas, middlewareIds, config] = await Promise.all([
		getBlocks(parent),
		getEdges(parent),
		listResponseSchemas(routeId),
		db.transaction((tx) => routeMiddlewareIds(routeId, tx)),
		readRouteConfig(routeId),
	]);
	const [middlewareNames, brokerNames] = await Promise.all([
		namesOf(middlewaresEntity, [...middlewareIds.before, ...middlewareIds.after]),
		namesOf(integrationsEntity, config.sseBrokerId ? [config.sseBrokerId] : []),
	]);
	const names = (ids: string[]) =>
		ids.map((id) => middlewareNames.get(id)).filter((n): n is string => !!n);

	return {
		kind: ROUTE_BUNDLE_KIND,
		version: ROUTE_BUNDLE_VERSION,
		exportedAt: new Date().toISOString(),
		route: {
			name: route.name!,
			path: route.path!,
			method: route.method as RouteBundle["route"]["method"],
			bodySchema: route.bodySchema ?? undefined,
			querySchema: route.querySchema ?? undefined,
			paramsSchema: route.paramsSchema ?? undefined,
			timeoutSeconds: route.timeoutSeconds,
			acceptedContentTypes: config.acceptedContentTypes,
			bodyMode: config.bodyMode,
			sseBroker: config.sseBrokerId ? brokerNames.get(config.sseBrokerId) : undefined,
		},
		canvas: {
			blocks: blocks.map((b) => ({
				id: b.id,
				type: b.type!,
				data: b.data,
				position: (b.position as { x: number; y: number }) ?? { x: 0, y: 0 },
			})),
			edges: edges.map((e) => ({
				id: e.id,
				from: e.from!,
				to: e.to!,
				fromHandle: e.fromHandle,
				toHandle: e.toHandle,
			})),
		},
		responseSchemas: schemas.map(({ statusCode, schema }) => ({ statusCode, schema })),
		middlewares: { before: names(middlewareIds.before), after: names(middlewareIds.after) },
		...(includeTests ? { suites: await exportSuites({ routeId }) } : {}),
	};
}
