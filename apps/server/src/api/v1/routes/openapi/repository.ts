import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../../../db";
import {
	type CanvasSnapshot,
	canvasVersionsEntity,
	httpRouteConfigEntity,
	projectsEntity,
	routeResponseSchemasEntity,
	routesEntity,
} from "../../../../db/schema";
import type { OpenApiEnv } from "./dto";

export async function getProject(projectId: string) {
	const res = await db
		.select()
		.from(projectsEntity)
		.where(eq(projectsEntity.id, projectId))
		.limit(1);
	return res[0];
}

export type ResponseSchemas = { statusCode: number; schema: unknown }[];

/** The working copies' schemas for every route of a project, by route id: what development serves. */
async function devResponseSchemas(projectId: string) {
	const rows = await db
		.select({
			routeId: routeResponseSchemasEntity.routeId,
			statusCode: routeResponseSchemasEntity.statusCode,
			schema: routeResponseSchemasEntity.schema,
		})
		.from(routeResponseSchemasEntity)
		.innerJoin(routesEntity, eq(routesEntity.id, routeResponseSchemasEntity.routeId))
		.where(eq(routesEntity.projectId, projectId));
	const byRoute = new Map<string, ResponseSchemas>();
	for (const { routeId, ...rest } of rows)
		byRoute.set(routeId, [...(byRoute.get(routeId) ?? []), rest]);
	return byRoute;
}

export async function getActiveRoutes(projectId: string, env: OpenApiEnv = "production") {
	if (env === "development") {
		const rows = await db
			.select({
				route: routesEntity,
				routeConfig: httpRouteConfigEntity.routeConfig,
				snapshot: canvasVersionsEntity.snapshot,
			})
			.from(routesEntity)
			.leftJoin(canvasVersionsEntity, eq(canvasVersionsEntity.id, routesEntity.prodVersionId))
			.leftJoin(httpRouteConfigEntity, eq(httpRouteConfigEntity.routeId, routesEntity.id))
			.where(and(eq(routesEntity.projectId, projectId), eq(routesEntity.devActive, true)));
		const responseSchemas = await devResponseSchemas(projectId);
		return rows.map(({ route, routeConfig, snapshot }) => {
			const settings = (snapshot as CanvasSnapshot | null)?.settings;
			return {
				...route,
				path: route.path ?? settings?.path,
				method: route.method ?? settings?.method,
				bodySchema: route.bodySchema ?? settings?.bodySchema,
				querySchema: route.querySchema ?? settings?.querySchema,
				paramsSchema: route.paramsSchema ?? settings?.paramsSchema,
				timeoutSeconds: route.timeoutSeconds ?? settings?.timeoutSeconds,
				routeConfig,
				responseSchemas: responseSchemas.get(route.id) ?? [],
			};
		});
	}

	const rows = await db
		.select({
			route: routesEntity,
			routeConfig: httpRouteConfigEntity.routeConfig,
			snapshot: canvasVersionsEntity.snapshot,
		})
		.from(routesEntity)
		.innerJoin(canvasVersionsEntity, eq(canvasVersionsEntity.id, routesEntity.prodVersionId))
		.leftJoin(httpRouteConfigEntity, eq(httpRouteConfigEntity.routeId, routesEntity.id))
		.where(
			and(
				eq(routesEntity.projectId, projectId),
				eq(routesEntity.active, true),
				isNotNull(routesEntity.prodVersionId),
			),
		);
	return rows.map(({ route, routeConfig, snapshot }) => {
		const settings = (snapshot as CanvasSnapshot | null)?.settings;
		return {
			...route,
			...(settings
				? {
						path: settings.path ?? route.path,
						method: settings.method ?? route.method,
						bodySchema: settings.bodySchema ?? route.bodySchema,
						querySchema: settings.querySchema ?? route.querySchema,
						paramsSchema: settings.paramsSchema ?? route.paramsSchema,
						timeoutSeconds: settings.timeoutSeconds ?? route.timeoutSeconds,
					}
				: {}),
			routeConfig,
			// production documents what its promoted version saved, never the working copy
			responseSchemas: (settings?.responseSchemas ?? []) as ResponseSchemas,
		};
	});
}
