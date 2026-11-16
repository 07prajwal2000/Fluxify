import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { deleteRoute } from "../../../api/v1/routes/delete/repository";
import { patchRouteConfig, readRouteConfig } from "../../../api/v1/routes/routeConfigRepository";
import { db } from "../../../db";
import { CHAN_ON_ROUTE_CHANGE, publishMessage } from "../../../db/redis";
import {
	type CanvasSnapshot,
	httpRouteConfigEntity,
	middlewaresEntity,
	routesEntity,
	testSuitesEntity,
	type VersionSnapshot,
} from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { dropRoute } from "../../compiler/service";
import { bundleSuiteSchema, exportSuites, writeSuites } from "../../transfer/suites";
import {
	backupHistorySchema,
	exportHistory,
	freshCanvasIds,
	importAsNewVersions,
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
	productionOff,
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
import { canvasOf, listOf, onOff, production, versionDetails } from "./preview";
import { byName, canvasUses, integrationUses } from "./rollback";

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

const suiteSchema = bundleSuiteSchema;

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

	preview: ({ routes }, mode) =>
		routes.map((r) => {
			const s = r.history.working.settings as CanvasSnapshot["settings"];
			return {
				name: r.name,
				summary: `${(s.method ?? "").toUpperCase()} ${s.path ?? ""}`.trim(),
				details: {
					Production: production(r.active, mode),
					Development: onOff(r.devActive),
					"Middlewares before": listOf(s.middlewares?.before ?? []),
					"Middlewares after": listOf(s.middlewares?.after ?? []),
					"Test suites": r.suites.length,
					...versionDetails(r.history),
				},
				canvas: canvasOf(r.history),
			};
		}),

	names: ({ routes }) => routes.map((r) => r.name),

	async existing(projectId, tx) {
		return byName(
			await tx
				.select({ id: routesEntity.id, name: routesEntity.name })
				.from(routesEntity)
				.where(eq(routesEntity.projectId, projectId))
				.orderBy(asc(routesEntity.createdAt)),
		);
	},

	uses: ({ routes, integrations }) =>
		routes.flatMap((r) => {
			const owner = `Route "${r.name}"`;
			const prod = r.history.versions.find((v) => v.number === r.history.prod)?.snapshot;
			const middlewares = [r.history.working, ...(prod ? [prod] : [])].flatMap((s) => {
				const m = (s.settings as CanvasSnapshot["settings"]).middlewares;
				return [...(m?.before ?? []), ...(m?.after ?? [])];
			});
			const hooks = r.suites.flatMap((s) => [s.setupBlock, s.teardownBlock, s.input?.loaderBlock]);
			return [
				...canvasUses(owner, r.history),
				...[...new Set(middlewares)].map((name) => ({ owner, section: "middlewares", name })),
				...[...new Set(hooks)].flatMap((name) =>
					name ? [{ owner, section: "customBlocks", name }] : [],
				),
				...integrationUses(owner, [r.history, r.config, r.suites], integrations),
			];
		}),

	/** keep extras: a restored route must not take the path and method of one the rollback keeps */
	async conflicts({ routes }, projectId, tx) {
		const restored = new Set(routes.map((r) => r.name));
		const extras = (
			await tx
				.select({ name: routesEntity.name, path: routesEntity.path, method: routesEntity.method })
				.from(routesEntity)
				.where(eq(routesEntity.projectId, projectId))
		).filter((r) => !restored.has(r.name ?? ""));
		const served = (path?: string | null, method?: string | null) =>
			`${(method ?? "").toUpperCase()} ${path ?? ""}`;
		return routes.flatMap((r) => {
			const s = r.history.working.settings as CanvasSnapshot["settings"];
			const clash = extras.find((e) => served(e.path, e.method) === served(s.path, s.method));
			if (!clash || !s.path) return [];
			return [
				{
					message: `Route "${r.name}" (${served(s.path, s.method)}) would serve the same path as route "${clash.name}", which this rollback keeps. Rename or move one of them, or choose Exact replica.`,
					mode: "keep" as const,
					selected: ["routes"],
					kept: [],
				},
			];
		});
	},

	async prune({ tx, projectId, afterCommit }, stale) {
		for (const { name, id } of stale) {
			await deleteRoute(id, tx);
			// as the delete endpoint does: the compiler can't find a deleted route's artifact key
			afterCommit(async () => {
				await dropRoute(projectId, id);
				const { invalidateOpenApiCache } = await import("../../../api/v1/routes/openapi/service");
				await invalidateOpenApiCache(projectId);
				await publishMessage(CHAN_ON_ROUTE_CHANGE, id);
			}, `Route "${name}" was removed, but workers may still serve it until the admin restarts.`);
		}
	},

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

	async import({ tx, projectId, mode, ids, match }, { routes, integrations }) {
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

			// a rollback keeps the route's id: its logs, runs and tokens stay valid
			const matched = match(fields.name);
			const values = { ...fields, ...productionOff(mode), projectId };
			const [row] = matched
				? await tx
						.update(routesEntity)
						.set(values)
						.where(eq(routesEntity.id, matched))
						.returning({ id: routesEntity.id })
				: await tx.insert(routesEntity).values(values).returning({ id: routesEntity.id });
			const target = { id: row!.id, projectId };
			if (matched) {
				// the backup's config and suites stand in for today's, not beside them
				await tx.delete(httpRouteConfigEntity).where(eq(httpRouteConfigEntity.routeId, matched));
				await tx.delete(testSuitesEntity).where(eq(testSuitesEntity.routeId, matched));
			}
			await patchRouteConfig(target.id, projectId, config, tx);
			// path, method, schemas, response schemas and middlewares come with the snapshot
			await restoreSnapshot("route", target, local(history.working as VersionSnapshot), tx);
			await (matched ? importAsNewVersions : importHistory)("route", target, history, local, tx);

			await writeSuites({ routeId: target.id }, suites, suiteRefs(ids, owner, history), tx);
			ids.set("routes", fields.name, target.id);
		}
	},
};
