import { z } from "zod";
import { assertionSchema, blockHookSchema } from "../../api/v1/test-suites/schema";
import { BODY_MODES, CONTENT_TYPES } from "../../lib/routeConfig";
import { canvasBlockSchema, canvasEdgeSchema } from "../canvas/types";

/**
 * The file a route is exported to: the route, its canvas, response schemas and
 * (optionally) its test suites. Things that belong to the project rather than
 * the route (middlewares, custom blocks, integrations) travel by *name*, so an
 * import into another project can match them; ids would never line up.
 */
export const ROUTE_BUNDLE_KIND = "fluxify.route";

/** Bump when the shape changes, and add the upgrade to `MIGRATIONS`. */
export const ROUTE_BUNDLE_VERSION = 1;

const suiteSchema = z.object({
	name: z.string().min(1),
	description: z.string().nullish(),
	headers: z.record(z.string(), z.string()).default({}),
	params: z.record(z.string(), z.string()).default({}),
	queryParams: z.record(z.string(), z.string()).default({}),
	routeParams: z.record(z.string(), z.string()).default({}),
	contentType: z.enum(CONTENT_TYPES).nullish(),
	body: z.unknown().optional(),
	assertions: z.array(assertionSchema).default([]),
	/** integration names: the one a route uses, and the one the suite swaps in */
	integrationOverrides: z
		.array(z.object({ existing: z.string(), replacement: z.string() }))
		.default([]),
	/** keys only: the values can be secrets and are never exported */
	appConfigOverrideKeys: z.array(z.string()).default([]),
	/** custom block names */
	setupBlock: z.string().nullish(),
	teardownBlock: z.string().nullish(),
	setupTimeoutMs: z.number().int().default(30_000),
	teardownTimeoutMs: z.number().int().default(30_000),
	runAlone: z.boolean().default(false),
	/** `blockId` is a block id of this bundle's canvas */
	hooks: z.array(blockHookSchema).default([]),
});

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
	canvas: z.object({ blocks: z.array(canvasBlockSchema), edges: z.array(canvasEdgeSchema) }),
	responseSchemas: z
		.array(z.object({ statusCode: z.number().int(), schema: z.record(z.string(), z.unknown()) }))
		.default([]),
	middlewares: z.object({
		before: z.array(z.string()).default([]),
		after: z.array(z.string()).default([]),
	}),
	/** absent when the export left tests out */
	suites: z.array(suiteSchema).optional(),
});

export type RouteBundle = z.infer<typeof routeBundleSchema>;
export type BundleSuite = z.infer<typeof suiteSchema>;

/** Upgrades keyed by the version they upgrade *from*. Never edit a released one. */
const MIGRATIONS: Record<number, (bundle: Record<string, unknown>) => Record<string, unknown>> = {};

/** Walks an older bundle up to the current version; a newer one is refused, not guessed at. */
export function migrateBundle(raw: Record<string, unknown>): Record<string, unknown> {
	let current = raw;
	while ((current.version as number) < ROUTE_BUNDLE_VERSION) {
		const upgrade = MIGRATIONS[current.version as number];
		if (!upgrade) break;
		current = upgrade(current);
	}
	return current;
}
