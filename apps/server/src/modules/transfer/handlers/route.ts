import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { setRouteMiddlewares } from "../../../api/v1/middlewares/repository";
import { requestBodySchema } from "../../../api/v1/routes/create/dto";
import createRoute from "../../../api/v1/routes/create/service";
import { readRouteConfig } from "../../../api/v1/routes/routeConfigRepository";
import { pathShape } from "../../../api/v1/routes/update/repository";
import { db } from "../../../db";
import { CHAN_ON_ROUTE_CHANGE, publishMessage } from "../../../db/redis";
import { integrationsEntity, middlewaresEntity, routesEntity } from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { NotFoundError } from "../../../errors/notFoundError";
import { BODY_MODES, CONTENT_TYPES, SSE_BROKER_VARIANTS } from "../../../lib/routeConfig";
import { listResponseSchemas, upsertResponseSchema } from "../../responseSchemas/repository";
import { routeMiddlewareIds } from "../../versions/snapshot";
import { bundleCanvasSchema, readBundleCanvas, writeBundleCanvas } from "../canvas";
import { type BundleSpec, envelopeHeader } from "../envelope";
import { idsByName, namesOf } from "../names";
import type { ConflictField, TransferHandler } from "../registry";
import { bundleSuiteSchema, exportSuites, importSuites } from "../suites";

/**
 * The file a route is exported to: the route, its canvas, response schemas and
 * (optionally) its test suites. Things that belong to the project rather than
 * the route (middlewares, custom blocks, integrations) travel by *name*, so an
 * import into another project can match them; ids would never line up.
 */
export const ROUTE_BUNDLE_KIND = "fluxify.route";

/** Bump when the shape changes, and add the upgrade to the spec's `migrations`. */
export const ROUTE_BUNDLE_VERSION = 1;

export const routeBundleSchema = z.object({
	kind: z.literal(ROUTE_BUNDLE_KIND),
	version: z.number().int().min(1),
	exportedAt: z.string(),
	route: z.object({
		name: z.string().min(2).max(255),
		path: z.string().min(1),
		method: z.enum(["GET", "POST", "PUT", "DELETE"]),
		bodySchema: z.any().optional(),
		querySchema: z.any().optional(),
		paramsSchema: z.any().optional(),
		timeoutSeconds: z.number().int().min(30).default(30),
		acceptedContentTypes: z.array(z.enum(CONTENT_TYPES)).min(1).optional(),
		bodyMode: z.enum(BODY_MODES).optional(),
		/** the SSE broker integration's name: integrations travel by name */
		sseBroker: z.string().optional(),
	}),
	canvas: bundleCanvasSchema,
	responseSchemas: z
		.array(z.object({ statusCode: z.number().int(), schema: z.record(z.string(), z.unknown()) }))
		.default([]),
	middlewares: z.object({
		before: z.array(z.string()).default([]),
		after: z.array(z.string()).default([]),
	}),
	/** absent when the export left tests out */
	suites: z.array(bundleSuiteSchema).optional(),
});

export type RouteBundle = z.infer<typeof routeBundleSchema>;

const spec: BundleSpec<RouteBundle> = {
	kind: ROUTE_BUNDLE_KIND,
	version: ROUTE_BUNDLE_VERSION,
	label: "route",
	schema: routeBundleSchema,
};

/**
 * What a route about to be imported would collide with in `projectId`. A name is
 * unique in the project, and so is a method on a path the router cannot tell
 * apart. Other projects never count.
 */
export async function routeConflicts(
	projectId: string,
	route: { name: string; path: string; method: string },
) {
	const inProject = eq(routesEntity.projectId, projectId);
	const [named] = await db
		.select({ id: routesEntity.id })
		.from(routesEntity)
		.where(and(inProject, eq(routesEntity.name, route.name)))
		.limit(1);
	const [pathed] = await db
		.select({ id: routesEntity.id })
		.from(routesEntity)
		.where(
			and(
				inProject,
				eq(routesEntity.method, route.method),
				sql`${pathShape(routesEntity.path)} = ${pathShape(sql`${route.path}`)}`,
			),
		)
		.limit(1);
	return { nameTaken: !!named, pathTaken: !!pathed };
}

/** the project's NATS or Redis integration with that name, if any */
async function sseBrokerByName(projectId: string, name: string | undefined) {
	if (!name) return undefined;
	const [row] = await db
		.select({ id: integrationsEntity.id })
		.from(integrationsEntity)
		.where(
			and(
				eq(integrationsEntity.projectId, projectId),
				eq(integrationsEntity.name, name),
				inArray(integrationsEntity.variant, SSE_BROKER_VARIANTS),
			),
		);
	return row?.id;
}

/** Reads a route into a bundle. The caller has already checked access. */
async function build(routeId: string, includeTests: boolean): Promise<RouteBundle> {
	const [route] = await db.select().from(routesEntity).where(eq(routesEntity.id, routeId));
	if (!route) throw new NotFoundError(`no route found with id: ${routeId}`);

	const [canvas, schemas, middlewareIds, config] = await Promise.all([
		readBundleCanvas({ type: "route", id: routeId }),
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
		...envelopeHeader(spec),
		kind: ROUTE_BUNDLE_KIND,
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
		canvas,
		responseSchemas: schemas.map(({ statusCode, schema }) => ({ statusCode, schema })),
		middlewares: { before: names(middlewareIds.before), after: names(middlewareIds.after) },
		...(includeTests ? { suites: await exportSuites({ routeId }) } : {}),
	};
}

/**
 * Creates the route, its canvas, response schemas, middlewares and tests from a
 * bundle, in one transaction. Middlewares, custom blocks and integrations are
 * matched to the project's by name; what has no match is dropped and reported
 * in `warnings`. The route is created off in production: it answers in
 * development until someone promotes it.
 */
async function importRoute(userId: string, projectId: string, bundle: RouteBundle) {
	const warnings: string[] = [];

	const sseBrokerId = await sseBrokerByName(projectId, bundle.route.sseBroker);
	if (bundle.route.sseBroker && !sseBrokerId) {
		warnings.push(
			`SSE broker "${bundle.route.sseBroker}" isn't a NATS or Redis integration in this project, so the route has none.`,
		);
	}
	const created = requestBodySchema.safeParse({
		...bundle.route,
		projectId,
		active: false,
		sseBrokerId,
	});
	if (!created.success) {
		throw new BadRequestError(`This route export is invalid: ${created.error.issues[0]!.message}`);
	}

	const middlewares = await idsByName(middlewaresEntity, projectId, [
		...bundle.middlewares.before,
		...bundle.middlewares.after,
	]);
	const matched = (phase: string[]) =>
		phase.filter((n) => {
			if (middlewares.has(n)) return true;
			warnings.push(`Middleware "${n}" doesn't exist in this project and was not attached.`);
			return false;
		});

	const routeId = await db.transaction(async (tx) => {
		const { id } = await createRoute(userId, created.data, tx, undefined, false, true);
		const blockIds = await writeBundleCanvas({ type: "route", id }, bundle.canvas, projectId, tx);

		for (const { statusCode, schema } of bundle.responseSchemas) {
			await upsertResponseSchema(id, statusCode, schema, tx);
		}

		const phases = {
			before: matched(bundle.middlewares.before).map((n) => middlewares.get(n)!),
			after: matched(bundle.middlewares.after).map((n) => middlewares.get(n)!),
		};
		await setRouteMiddlewares(id, projectId, phases, tx);

		await importSuites(
			{ routeId: id },
			bundle.suites ?? [],
			{ projectId, blockIds, warnings, label: spec.label },
			tx,
		);
		return id;
	});

	await publishMessage(CHAN_ON_ROUTE_CHANGE, routeId);
	return { id: routeId, warnings };
}

export const routeHandler: TransferHandler<RouteBundle> = {
	spec,
	async projectOf(id) {
		const [row] = await db
			.select({ projectId: routesEntity.projectId })
			.from(routesEntity)
			.where(eq(routesEntity.id, id));
		if (!row) throw new NotFoundError(`no route found with id: ${id}`);
		return row.projectId!;
	},
	build,
	async conflicts(projectId, bundle) {
		const { nameTaken, pathTaken } = await routeConflicts(projectId, bundle.route);
		const found: ConflictField[] = [];
		if (nameTaken) found.push("name");
		if (pathTaken) found.push("path");
		return found;
	},
	import: ({ userId }, projectId, bundle) => importRoute(userId, projectId, bundle),
};
