import type { z } from "zod";
import { db } from "../../../../db";
import { deleteArtifactEverywhere } from "../../../../db/natsKv";
import {
	CHAN_ON_APPCONFIG_CHANGE,
	CHAN_ON_CUSTOM_BLOCK_CHANGE,
	CHAN_ON_INTEGRATION_CHANGE,
	CHAN_ON_PROJECT_SETTING_CHANGE,
	CHAN_ON_ROUTE_CHANGE,
	CHAN_ON_WORKFLOW_CHANGE,
	publishMessage,
} from "../../../../db/redis";
import { NotFoundError } from "../../../../errors/notFoundError";
import { audit, forgetProject } from "../../../../modules/audit";
import { dropSandbox } from "../../../../modules/compiler/sandbox";
import { dropCustomBlock, dropRoute, dropWorkflow } from "../../../../modules/compiler/service";
import { middlewareKey } from "../../../../modules/compiler/subjects";
import { removeScheduleEverywhere } from "../../../../modules/schedules/reconciler";
import { withdraw } from "../../triggers/service";
import type { responseSchema } from "./dto";
import {
	clearRestrictedRows,
	deleteProjectRow,
	findProjectById,
	findProjectContents,
} from "./repository";

/**
 * Deletes a project and everything it owns. The foreign keys remove the rows
 * (routes, workflows, triggers, blocks, settings, members, ...). They cannot
 * remove the artifacts on the broker, so those are read first and withdrawn
 * after the commit, the way deleting each item does it. A running trigger stops.
 */
export default async function handleRequest(id: string): Promise<z.infer<typeof responseSchema>> {
	const contents = await db.transaction(async (tx) => {
		const project = await findProjectById(id, tx);
		if (!project) throw new NotFoundError("Project not found");
		const found = await findProjectContents(id, tx);
		await clearRestrictedRows(id, tx);
		await deleteProjectRow(id, tx);
		// the log row keeps the project's name and slug: the project will not be there to ask
		await audit.record({
			projectId: id,
			resourceType: "project",
			resourceId: id,
			action: "delete",
			changedFields: [],
			project: { name: project.name ?? undefined, slug: project.slug ?? undefined },
		});
		return found;
	});
	forgetProject(id);

	// Withdraw after the commit: a consumer must not outlive its row for long.
	await Promise.all(
		contents.triggers.map((trigger) =>
			trigger.type === "schedule"
				? removeScheduleEverywhere(id, trigger.id)
				: withdraw(id, trigger.id),
		),
	);
	await Promise.all([
		...contents.routes.map((routeId) => dropRoute(id, routeId)),
		...contents.workflows.map((workflowId) => dropWorkflow(id, workflowId)),
		...contents.middlewares.map((mid) => deleteArtifactEverywhere(middlewareKey(id, mid))),
		...contents.customBlocks.map((blockId) => dropCustomBlock(id, blockId)),
		...contents.sandboxes.map((sandboxId) => dropSandbox(id, sandboxId)),
	]);

	// the same change signals each item's delete sends, so caches and compilers drop them
	for (const routeId of contents.routes) await publishMessage(CHAN_ON_ROUTE_CHANGE, routeId);
	for (const workflowId of contents.workflows)
		await publishMessage(CHAN_ON_WORKFLOW_CHANGE, workflowId);
	for (const blockId of contents.customBlocks)
		await publishMessage(CHAN_ON_CUSTOM_BLOCK_CHANGE, blockId);
	await publishMessage(CHAN_ON_APPCONFIG_CHANGE, "");
	await publishMessage(CHAN_ON_INTEGRATION_CHANGE, "");
	await publishMessage(CHAN_ON_PROJECT_SETTING_CHANGE, "");

	return { id };
}
