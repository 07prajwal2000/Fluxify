import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { deleteWorkflowRow } from "../../../api/v1/workflows/repository";
import { db } from "../../../db";
import { CHAN_ON_WORKFLOW_CHANGE, publishMessage } from "../../../db/redis";
import { testSuitesEntity, type VersionSnapshot, workflowsEntity } from "../../../db/schema";
import { dropWorkflow } from "../../compiler/service";
import { bundleSuiteSchema, exportSuites, writeSuites } from "../../transfer/suites";
import {
	backupHistorySchema,
	exportHistory,
	freshCanvasIds,
	importAsNewVersions,
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
import { canvasOf, onOff, production, versionDetails } from "./preview";
import { byName, canvasUses, integrationUses } from "./rollback";

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
	suites: z.array(bundleSuiteSchema).default([]),
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

	preview: ({ workflows }, mode) =>
		workflows.map((w) => ({
			name: w.name,
			summary: w.description ?? undefined,
			details: {
				Production: production(w.active, mode),
				Development: onOff(w.devActive),
				"Test suites": w.suites.length,
				...versionDetails(w.history),
			},
			canvas: canvasOf(w.history),
		})),

	names: ({ workflows }) => workflows.map((w) => w.name),

	async existing(projectId, tx) {
		return byName(
			await tx
				.select({ id: workflowsEntity.id, name: workflowsEntity.name })
				.from(workflowsEntity)
				.where(eq(workflowsEntity.projectId, projectId))
				.orderBy(asc(workflowsEntity.createdAt)),
		);
	},

	uses: ({ workflows, integrations }) =>
		workflows.flatMap((w) => {
			const owner = `Workflow "${w.name}"`;
			const hooks = w.suites.flatMap((s) => [s.setupBlock, s.teardownBlock, s.input?.loaderBlock]);
			return [
				...canvasUses(owner, w.history),
				...[...new Set(hooks)].flatMap((name) =>
					name ? [{ owner, section: "customBlocks", name }] : [],
				),
				...integrationUses(owner, [w.history, w.suites], integrations),
			];
		}),

	async prune({ tx, projectId, afterCommit }, stale) {
		for (const { name, id } of stale) {
			// its triggers keep their rows, idle (the column is set null), unless the triggers section prunes them first
			await deleteWorkflowRow(id, tx);
			afterCommit(async () => {
				await dropWorkflow(projectId, id);
				await publishMessage(CHAN_ON_WORKFLOW_CHANGE, id);
			}, `Workflow "${name}" was removed, but workers may still run it until the admin restarts.`);
		}
	},

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

	async import({ tx, projectId, mode, ids, match }, { workflows, integrations }) {
		const lookup = localIntegrations(integrations, ids);
		for (const workflow of workflows) {
			const raw = remapIntegrations(workflow, lookup);
			// one fresh id per canvas id, in the versions and the suites' hooks alike
			const { history, suites, ...fields } = freshCanvasIds(raw, raw.history);
			const owner = `Workflow "${fields.name}"`;
			assertCustomBlocks(ids, owner, history);

			// a rollback keeps the workflow's id: its runs and triggers stay attached
			const matched = match(fields.name);
			const values = { ...fields, ...productionOff(mode), projectId };
			const [row] = matched
				? await tx
						.update(workflowsEntity)
						.set(values)
						.where(eq(workflowsEntity.id, matched))
						.returning({ id: workflowsEntity.id })
				: await tx.insert(workflowsEntity).values(values).returning({ id: workflowsEntity.id });
			const target = { id: row!.id, projectId };
			if (matched)
				await tx.delete(testSuitesEntity).where(eq(testSuitesEntity.workflowId, matched));
			// the timeout comes with the snapshot
			await restoreSnapshot("workflow", target, history.working as VersionSnapshot, tx);
			await (matched ? importAsNewVersions : importHistory)("workflow", target, history, same, tx);
			await writeSuites({ workflowId: target.id }, suites, suiteRefs(ids, owner, history), tx);
			ids.set("workflows", fields.name, target.id);
		}
	},
};
