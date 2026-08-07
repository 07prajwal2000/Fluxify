import { HttpRouteParser } from "@fluxify/lib";
import { db } from "../db";
import {
	httpRouteConfigEntity,
	projectsEntity,
	routesEntity,
} from "../db/schema";
import { acceptedContentTypes } from "../lib/routeConfig";
import {
	CHAN_ON_ROUTE_CHANGE,
	deleteCacheKey,
	subscribeToChannel,
} from "../db/redis";
import { eq } from "drizzle-orm";
import { logger } from "@fluxify/common";
import { getEnv } from "../lib/env";

export async function loadRoutes() {
	const parser = new HttpRouteParser();
	const routes = await fetchRoutes();

	const canHotreload = getEnv("HOT_RELOAD_ROUTES") == "true";
	if (canHotreload) {
		// register to chan:on-route-change signal from redis event
		logger.info("routes hot reloading enabled");
		subscribeToChannel(CHAN_ON_ROUTE_CHANGE, async (id) => {
			if (id) {
				await deleteCacheKey(`${id}_GRAPH`);
			}
			const { invalidateOpenApiCache } = await import("../api/v1/routes/openapi/service");
			await invalidateOpenApiCache();
			const fetchedRoutes = await fetchRoutes();
			// @ts-ignore
			parser.rebuildRoutes(fetchedRoutes);
			logger.info("reloaded routes from db");
		});
	}

	// @ts-ignore
	parser.buildRoutes(routes);
	return parser;
}

async function fetchRoutes() {
	const routes = await db
		.select({
			method: routesEntity.method,
			path: routesEntity.path,
			routeId: routesEntity.id,
			projectId: routesEntity.projectId,
			projectName: projectsEntity.name,
			bodySchema: routesEntity.bodySchema,
			querySchema: routesEntity.querySchema,
			paramsSchema: routesEntity.paramsSchema,
			timeoutSeconds: routesEntity.timeoutSeconds,
			routeConfig: httpRouteConfigEntity.routeConfig,
		})
		.from(routesEntity)
		.leftJoin(projectsEntity, eq(routesEntity.projectId, projectsEntity.id))
		.leftJoin(
			httpRouteConfigEntity,
			eq(httpRouteConfigEntity.routeId, routesEntity.id),
		)
		.where(eq(routesEntity.active, true));

	return routes.map(({ routeConfig, ...route }) => ({
		...route,
		acceptedContentTypes: acceptedContentTypes(routeConfig),
	}));
}
