import { eq, inArray } from "drizzle-orm";
import { readRouteConfig } from "../../api/v1/routes/routeConfigRepository";
import { db } from "../../db";
import {
	blocksEntity,
	customBlocksListEntity,
	integrationsEntity,
	middlewaresEntity,
	routesEntity,
	testSuiteBlockHooksEntity,
	testSuitesEntity,
} from "../../db/schema";
import { NotFoundError } from "../../errors/notFoundError";
import { getBlocks, getEdges } from "../canvas/repository";
import { listResponseSchemas } from "../responseSchemas/repository";
import { routeMiddlewareIds } from "../versions/snapshot";
import {
	type BundleSuite,
	ROUTE_BUNDLE_KIND,
	ROUTE_BUNDLE_VERSION,
	type RouteBundle,
} from "./bundle";

/** id → name for rows of `table`, so references can travel by name */
async function namesOf(
	table: typeof middlewaresEntity | typeof customBlocksListEntity | typeof integrationsEntity,
	ids: string[],
) {
	if (ids.length === 0) return new Map<string, string>();
	const rows = await db
		.select({ id: table.id, name: table.name })
		.from(table)
		.where(inArray(table.id, ids));
	return new Map(rows.map((r) => [r.id, r.name ?? ""]));
}

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
	const middlewareNames = await namesOf(middlewaresEntity, [
		...middlewareIds.before,
		...middlewareIds.after,
	]);
	const names = (ids: string[]) =>
		ids.map((id) => middlewareNames.get(id)).filter((n): n is string => !!n);

	return {
		kind: ROUTE_BUNDLE_KIND,
		version: ROUTE_BUNDLE_VERSION,
		exportedAt: new Date().toISOString(),
		sourceProjectId: route.projectId,
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
		...(includeTests ? { suites: await exportSuites(routeId) } : {}),
	};
}

async function exportSuites(routeId: string): Promise<NonNullable<RouteBundle["suites"]>> {
	const suites = await db
		.select()
		.from(testSuitesEntity)
		.where(eq(testSuitesEntity.routeId, routeId))
		.orderBy(testSuitesEntity.createdAt);
	if (suites.length === 0) return [];

	const hooks = await db
		.select()
		.from(testSuiteBlockHooksEntity)
		.where(
			inArray(
				testSuiteBlockHooksEntity.suiteId,
				suites.map((s) => s.id),
			),
		);
	const blockNames = await namesOf(
		customBlocksListEntity,
		suites.flatMap((s) => [s.setupBlockId, s.teardownBlockId]).filter((id): id is string => !!id),
	);
	const integrationNames = await namesOf(
		integrationsEntity,
		suites.flatMap((s) => (s.integrationOverrides ?? []).flatMap((o) => [o.existingId, o.newId])),
	);

	return suites.map((s) => ({
		name: s.name,
		description: s.description,
		headers: s.headers ?? {},
		params: s.params ?? {},
		queryParams: s.queryParams ?? {},
		routeParams: s.routeParams ?? {},
		contentType: s.contentType as BundleSuite["contentType"],
		body: s.body ?? undefined,
		assertions: s.assertions,
		integrationOverrides: (s.integrationOverrides ?? []).flatMap((o) => {
			const existing = integrationNames.get(o.existingId);
			const replacement = integrationNames.get(o.newId);
			return existing && replacement ? [{ existing, replacement }] : [];
		}),
		appConfigOverrideKeys: (s.appConfigOverrides ?? []).map((o) => o.key),
		setupBlock: s.setupBlockId ? (blockNames.get(s.setupBlockId) ?? null) : null,
		teardownBlock: s.teardownBlockId ? (blockNames.get(s.teardownBlockId) ?? null) : null,
		setupTimeoutMs: s.setupTimeoutMs,
		teardownTimeoutMs: s.teardownTimeoutMs,
		runAlone: s.runAlone,
		hooks: hooks
			.filter((h) => h.suiteId === s.id)
			.map((h) => ({ blockId: h.blockId, onBefore: h.onBefore, onAfter: h.onAfter })),
	}));
}
