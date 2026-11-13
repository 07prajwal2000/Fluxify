import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import { type VersionSnapshot, workflowsEntity } from "../../../db/schema";
import { routeBundleSchema } from "../../routeTransfer/bundle";
import { exportSuites, writeSuites } from "../../routeTransfer/suites";
import {
	backupHistorySchema,
	exportHistory,
	freshCanvasIds,
	importHistory,
} from "../../versions/backup";
import { buildSnapshot, restoreSnapshot } from "../../versions/snapshot";
import type { BackupModule } from "../types";
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

/**
 * Every workflow of a project (#1098), shaped like routes (#1097): the canvas
 * and the timeout are versioned and travel in `history`; the live flags and the
 * test suites (with their input loader) travel beside it. A workflow has no
 * middlewares, so its snapshots hold no reference to rename. Its triggers are
 * the `triggers` section's.
 *
 * Integration ids (in block data and suite overrides) resolve through the
 * section's integration table (#1100, v2); one that doesn't is blanked.
 */

const workflowSchema = z.object({
	name: z.string().min(1),
	description: z.string().nullable().default(null),
	active: z.boolean().default(false),
	devActive: z.boolean().default(true),
	tracingEnabled: z.boolean().default(false),
	recordExecution: z.boolean().default(false),
	devTracingEnabled: z.boolean().default(false),
	devRecordExecution: z.boolean().default(true),
	suites: z.array(routeBundleSchema.shape.suites.unwrap().element).default([]),
	history: backupHistorySchema,
});

const schema = z.object({
	workflows: z.array(workflowSchema),
	integrations: integrationTableSchema,
});
type Section = z.infer<typeof schema>;

const same = (snapshot: VersionSnapshot) => snapshot;

export const workflowsModule: BackupModule<Section> = {
	name: "workflows",
	version: 2,
	minSupported: 1,
	upgrades: {
		// v1 kept integration ids with no names
		1: (data) => ({ ...(data as object), integrations: v1Table(data) }),
	},
	dependsOn: ["integrations", "plugins", "customBlocks"],
	schema,

	inspect({ workflows, integrations }, read) {
		const have = restoredNames(read);
		return workflows.flatMap((w) => [
			...lostWarnings(
				`Workflow "${w.name}"`,
				[
					...canvasPlaces(w.history),
					...w.suites.map((s) => ({ where: `test "${s.name}"`, value: s.integrationOverrides })),
				],
				integrations,
				have,
				`${BLANK_BLOCK} A blank test override is dropped.`,
			),
			...missingPluginWarnings(
				`Workflow "${w.name}"`,
				pluginPlaces(w.history),
				read,
				MISSING_PLUGIN_BLOCK,
			),
		]);
	},

	async export({ projectId, options }) {
		const data = await db.transaction(async (tx) => {
			const rows = await tx
				.select()
				.from(workflowsEntity)
				.where(eq(workflowsEntity.projectId, projectId))
				.orderBy(asc(workflowsEntity.createdAt));
			const out: Section["workflows"] = [];
			for (const row of rows) {
				const working = await buildSnapshot("workflow", row.id, tx);
				out.push({
					name: row.name!,
					description: row.description,
					active: row.active ?? false,
					devActive: row.devActive,
					tracingEnabled: row.tracingEnabled,
					recordExecution: row.recordExecution,
					devTracingEnabled: row.devTracingEnabled,
					devRecordExecution: row.devRecordExecution,
					suites: await exportSuites(
						{ workflowId: row.id },
						// never in a template: it keeps the keys only
						{ tx, integrationIds: true, values: options.includeAppConfigValues },
					),
					history: await exportHistory(
						"workflow",
						row.id,
						working,
						options.includeVersionHistory,
						same,
						tx,
					),
				});
			}
			const names = await integrationNames(projectId, tx);
			return { workflows: out, integrations: tableFor(out, names) };
		});
		return { data };
	},

	async import({ tx, projectId, ids }, { workflows, integrations }) {
		const lookup = localIntegrations(integrations, ids);
		for (const workflow of workflows) {
			const raw = remapIntegrations(workflow, lookup);
			// one fresh id per canvas id, in the versions and the suites' hooks alike
			const { history, suites, ...fields } = freshCanvasIds(raw, raw.history);
			const owner = `Workflow "${fields.name}"`;
			assertCustomBlocks(ids, owner, history);

			const [row] = await tx
				.insert(workflowsEntity)
				.values({ ...fields, projectId })
				.returning({ id: workflowsEntity.id });
			const target = { id: row!.id, projectId };
			// the timeout comes with the snapshot
			await restoreSnapshot("workflow", target, history.working as VersionSnapshot, tx);
			await importHistory("workflow", target, history, same, tx);
			await writeSuites({ workflowId: target.id }, suites, suiteRefs(ids, owner, history), tx);
			ids.set("workflows", fields.name, target.id);
		}
	},
};
