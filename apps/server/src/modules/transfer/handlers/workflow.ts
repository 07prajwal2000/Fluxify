import { eq } from "drizzle-orm";
import { z } from "zod";
import { findWorkflowByName } from "../../../api/v1/workflows/repository";
import { createWorkflow } from "../../../api/v1/workflows/service";
import { db } from "../../../db";
import { CHAN_ON_WORKFLOW_CHANGE, publishMessage } from "../../../db/redis";
import { workflowsEntity } from "../../../db/schema";
import { NotFoundError } from "../../../errors/notFoundError";
import { bundleCanvasSchema, readBundleCanvas, writeBundleCanvas } from "../canvas";
import { type BundleSpec, envelopeHeader } from "../envelope";
import type { ConflictField, TransferHandler } from "../registry";
import { bundleSuiteSchema, exportSuites, importSuites } from "../suites";

/**
 * The file a workflow is exported to: the workflow, its canvas and (optionally)
 * its test suites. Triggers and observability settings never travel: a trigger
 * is wired to the project's infrastructure, so an import creates none.
 */
export const WORKFLOW_BUNDLE_KIND = "fluxify.workflow";

/** Bump when the shape changes, and add the upgrade to the spec's `migrations`. */
export const WORKFLOW_BUNDLE_VERSION = 1;

export const workflowBundleSchema = z.object({
	kind: z.literal(WORKFLOW_BUNDLE_KIND),
	version: z.number().int().min(1),
	exportedAt: z.string(),
	workflow: z.object({
		name: z.string().min(2).max(255),
		description: z.string().max(2000).nullish(),
		timeoutSeconds: z.number().int().min(30).max(3600).default(300),
	}),
	canvas: bundleCanvasSchema,
	/** absent when the export left tests out */
	suites: z.array(bundleSuiteSchema).optional(),
});

export type WorkflowBundle = z.infer<typeof workflowBundleSchema>;

const spec: BundleSpec<WorkflowBundle> = {
	kind: WORKFLOW_BUNDLE_KIND,
	version: WORKFLOW_BUNDLE_VERSION,
	label: "workflow",
	schema: workflowBundleSchema,
};

export const workflowHandler: TransferHandler<WorkflowBundle> = {
	spec,
	async projectOf(id) {
		const [row] = await db
			.select({ projectId: workflowsEntity.projectId })
			.from(workflowsEntity)
			.where(eq(workflowsEntity.id, id));
		if (!row) throw new NotFoundError(`no workflow found with id: ${id}`);
		return row.projectId!;
	},
	async build(id, includeTests) {
		const [row] = await db.select().from(workflowsEntity).where(eq(workflowsEntity.id, id));
		if (!row) throw new NotFoundError(`no workflow found with id: ${id}`);
		return {
			...envelopeHeader(spec),
			kind: WORKFLOW_BUNDLE_KIND,
			workflow: {
				name: row.name!,
				...(row.description ? { description: row.description } : {}),
				timeoutSeconds: row.timeoutSeconds,
			},
			canvas: await readBundleCanvas({ type: "workflow", id }),
			...(includeTests ? { suites: await exportSuites({ workflowId: id }) } : {}),
		};
	},
	async conflicts(projectId, bundle) {
		const found: ConflictField[] = [];
		if (await findWorkflowByName(projectId, bundle.workflow.name)) found.push("name");
		return found;
	},
	/**
	 * Creates the workflow, canvas and tests in one transaction. It is created
	 * off in production (it runs in development until someone promotes it).
	 */
	async import(actor, projectId, bundle) {
		const warnings: string[] = [];
		const id = await db.transaction(async (tx) => {
			// seedBlocks=false: the canvas carries its own entrypoint
			const { id } = await createWorkflow(
				actor.userId,
				{
					...bundle.workflow,
					description: bundle.workflow.description ?? undefined,
					projectId,
					active: false,
				},
				actor.acl,
				tx,
				undefined,
				false,
			);
			const blockIds = await writeBundleCanvas(
				{ type: "workflow", id },
				bundle.canvas,
				projectId,
				tx,
			);
			await importSuites(
				{ workflowId: id },
				bundle.suites ?? [],
				{ projectId, blockIds, warnings, label: spec.label },
				tx,
			);
			return id;
		});
		await publishMessage(CHAN_ON_WORKFLOW_CHANGE, id);
		return { id, warnings };
	},
};
