import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { patchRouteConfig, readRouteConfig } from "../../../api/v1/routes/routeConfigRepository";
import { db } from "../../../db";
import {
	type CanvasSnapshot,
	middlewaresEntity,
	routesEntity,
	type VersionSnapshot,
} from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { routeBundleSchema } from "../../routeTransfer/bundle";
import { exportSuites, writeSuites } from "../../routeTransfer/suites";
import {
	backupHistorySchema,
	exportHistory,
	freshCanvasIds,
	importHistory,
} from "../../versions/backup";
import { buildSnapshot, restoreSnapshot } from "../../versions/snapshot";
import type { BackupModule, IdMap } from "../types";
import {
	assertCustomBlocks,
	BLANK_BLOCK,
	canvasPlaces,
	MISSING_PLUGIN_BLOCK,
	missingPluginWarnings,
	pluginPlaces,
	suiteRefs,
} from "./canvas";
import {
	integrationNames,
	integrationTableSchema,
	localIntegrations,
	lostWarnings,
	remapIntegrations,
	restoredNames,
	tableFor,
	v1Table,
} from "./integrationRefs";

const BLANK_ROUTE = `${BLANK_BLOCK} A blank SSE broker leaves the route without one, and a blank test override is dropped.`;

/**
 * Every route of a project (#1097). The canvas, path, schemas, response schemas
 * and middleware attachments are versioned, so they travel once, in `history`
 * (the working copy and the promoted version). The row's live fields, the HTTP
 * route config and the test suites (in the `.fluxroute` bundle's form) travel
 * beside it.
 *
 * Middlewares travel by name. A custom block is called by its name already.
 * Integration ids (in block data, the SSE broker and suite overrides) resolve
 * through the section's integration table (#1100, v2); one that doesn't is
 * blanked: the block has none, the route no SSE broker, the override is dropped.
 */

const suiteSchema = routeBundleSchema.shape.suites.unwrap().element;

const routeSchema = z.object({
	name: z.string().min(1),
	active: z.boolean().default(false),
	devActive: z.boolean().default(true),
	tracingEnabled: z.boolean().default(false),
	recordExecution: z.boolean().default(false),
	devTracingEnabled: z.boolean().default(false),
	devRecordExecution: z.boolean().default(true),
	/** the HTTP route config as the workers read it: content types, body mode, SSE broker id */
	config: z.record(z.string(), z.unknown()).default({}),
	suites: z.array(suiteSchema).default([]),
	history: backupHistorySchema,
});

const schema = z.object({ routes: z.array(routeSchema), integrations: integrationTableSchema });
type Section = z.infer<typeof schema>;

type Phases = { before: string[]; after: string[] };

const mapMiddlewares = (snapshot: VersionSnapshot, map: (ids: string[]) => string[]) => {
	const settings = (snapshot as CanvasSnapshot).settings;
	if (!settings.middlewares) return snapshot;
	const middlewares: Phases = {
		before: map(settings.middlewares.before),
		after: map(settings.middlewares.after),
	};
	return { ...snapshot, settings: { ...settings, middlewares } } as VersionSnapshot;
};

/** names → this project's ids. A route that loses a middleware would run differently, so refuse. */
const localMiddlewares = (ids: IdMap, route: string) => (snapshot: VersionSnapshot) =>
	mapMiddlewares(snapshot, (names) =>
		names.map((name) => {
			const id = ids.get("middlewares", name);
			if (!id)
				throw new BadRequestError(
					`Route "${route}" uses the middleware "${name}", which isn't in this backup.`,
				);
			return id;
		}),
	);

export const routesModule: BackupModule<Section> = {
	name: "routes",
	version: 2,
	minSupported: 1,
	upgrades: {
		// v1 kept integration ids with no names
		1: (data) => ({ ...(data as object), integrations: v1Table(data) }),
	},
	dependsOn: ["integrations", "plugins", "customBlocks", "middlewares"],
	schema,

	inspect({ routes, integrations }, read) {
		const have = restoredNames(read);
		return routes.flatMap((r) => [
			...lostWarnings(
				`Route "${r.name}"`,
				[
					...canvasPlaces(r.history),
					{ where: "SSE broker", value: r.config.sseBrokerId },
					...r.suites.map((s) => ({ where: `test "${s.name}"`, value: s.integrationOverrides })),
				],
				integrations,
				have,
				BLANK_ROUTE,
			),
			...missingPluginWarnings(
				`Route "${r.name}"`,
				pluginPlaces(r.history),
				read,
				MISSING_PLUGIN_BLOCK,
			),
		]);
	},

	async export({ projectId, options }) {
		const data = await db.transaction(async (tx) => {
			const middlewares = await tx
				.select({ id: middlewaresEntity.id, name: middlewaresEntity.name })
				.from(middlewaresEntity)
				.where(eq(middlewaresEntity.projectId, projectId));
			const nameOf = new Map(middlewares.map((m) => [m.id, m.name]));
			// a middleware deleted since a version was committed has no name to travel by
			const portable = (snapshot: VersionSnapshot) =>
				mapMiddlewares(snapshot, (list) =>
					list.flatMap((id) => (nameOf.has(id) ? [nameOf.get(id)!] : [])),
				);

			const rows = await tx
				.select()
				.from(routesEntity)
				.where(eq(routesEntity.projectId, projectId))
				.orderBy(asc(routesEntity.createdAt));
			const out: Section["routes"] = [];
			for (const row of rows) {
				const working = await buildSnapshot("route", row.id, tx);
				out.push({
					name: row.name!,
					active: row.active ?? false,
					devActive: row.devActive,
					tracingEnabled: row.tracingEnabled,
					recordExecution: row.recordExecution,
					devTracingEnabled: row.devTracingEnabled,
					devRecordExecution: row.devRecordExecution,
					config: await readRouteConfig(row.id, tx),
					suites: await exportSuites(
						{ routeId: row.id },
						{
							tx,
							integrationIds: true,
							// never in a template: it keeps the keys only, as a `.fluxroute` export does
							values: options.includeAppConfigValues,
						},
					),
					history: await exportHistory(
						"route",
						row.id,
						working,
						options.includeVersionHistory,
						portable,
						tx,
					),
				});
			}
			const names = await integrationNames(projectId, tx);
			return { routes: out, integrations: tableFor(out, names) };
		});
		return { data };
	},

	async import({ tx, projectId, ids }, { routes, integrations }) {
		const lookup = localIntegrations(integrations, ids);
		for (const route of routes) {
			const raw = remapIntegrations(route, lookup);
			// one fresh id per canvas id, in the versions and the suites' hooks alike
			const { history, suites, config, ...fields } = freshCanvasIds(raw, raw.history);
			// a broker that didn't resolve is none
			if (config.sseBrokerId === "") config.sseBrokerId = null;
			const owner = `Route "${fields.name}"`;
			assertCustomBlocks(ids, owner, history);
			const local = localMiddlewares(ids, fields.name);

			const [row] = await tx
				.insert(routesEntity)
				.values({ ...fields, projectId })
				.returning({ id: routesEntity.id });
			const target = { id: row!.id, projectId };
			await patchRouteConfig(target.id, projectId, config, tx);
			// path, method, schemas, response schemas and middlewares come with the snapshot
			await restoreSnapshot("route", target, local(history.working as VersionSnapshot), tx);
			await importHistory("route", target, history, local, tx);

			await writeSuites({ routeId: target.id }, suites, suiteRefs(ids, owner, history), tx);
			ids.set("routes", fields.name, target.id);
		}
	},
};
