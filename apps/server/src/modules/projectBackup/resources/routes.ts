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
import { assertCustomBlocks, suiteRefs } from "./canvas";

/**
 * Every route of a project (#1097). The canvas, path, schemas, response schemas
 * and middleware attachments are versioned, so they travel once, in `history`
 * (the working copy and the promoted version). The row's live fields, the HTTP
 * route config and the test suites (in the `.fluxroute` bundle's form) travel
 * beside it.
 *
 * Middlewares travel by name. A custom block is called by its name already.
 * Integration ids (in block data, the SSE broker and suite overrides) are
 * copied as they are until #1100 restores integrations and remaps them.
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

const schema = z.object({ routes: z.array(routeSchema) });
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
	version: 1,
	minSupported: 1,
	upgrades: {},
	// integration ids are copied as they are; #1100 adds "integrations" and remaps them
	dependsOn: ["customBlocks", "middlewares"],
	schema,

	async export({ projectId, options }) {
		const routes = await db.transaction(async (tx) => {
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
			return out;
		});
		return { data: { routes } };
	},

	async import({ tx, projectId, ids }, { routes }) {
		for (const raw of routes) {
			// one fresh id per canvas id, in the versions and the suites' hooks alike
			const { history, suites, config, ...fields } = freshCanvasIds(raw, raw.history);
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
