import type { z } from "zod";
import { db } from "../../../db";
import { deleteArtifactEverywhere } from "../../../db/natsKv";
import { CHAN_ON_SANDBOX_CHANGE, publishMessage } from "../../../db/redis";
import { ConflictError } from "../../../errors/conflictError";
import { NotFoundError } from "../../../errors/notFoundError";
import { audit, bodyFields } from "../../../modules/audit";
import { dropSandbox } from "../../../modules/compiler/sandbox";
import { triggerKey } from "../../../modules/compiler/subjects";
import { devWorkerOnline } from "../../../modules/orchestrator/status";
import { fireInternalTrigger } from "../../../modules/triggers/publisher";
import { assertOwnSandbox } from "../triggers/sandboxes";
import type { runAcceptedSchema, runSchema } from "../workflows/dto";
import { projectExists, seedDefaultBlocks } from "../workflows/repository";
import { maxSandboxesPerUser } from "./cap";
import type { createSchema, patchSchema, sandboxSchema } from "./dto";
import {
	countSandboxes,
	deleteSandboxRow,
	type findSandbox,
	insertSandbox,
	listSandboxes,
	sandboxTriggerIds,
	updateSandboxRow,
} from "./repository";

/**
 * Sandbox CRUD (#735). A sandbox is its owner's alone: the routes require the
 * creator role in the project, and everything here answers 404 to anyone but
 * the owner — a system admin included — so another user cannot even learn one
 * exists. Every write ends in a change signal, which recompiles it.
 */

type Sandbox = NonNullable<Awaited<ReturnType<typeof findSandbox>>>;

/** Loads a sandbox the caller owns in this project, or reports it as missing. */
export const mustOwn = assertOwnSandbox;

export async function createSandbox(
	projectId: string,
	userId: string,
	data: z.infer<typeof createSchema>,
) {
	const id = await db.transaction(async (tx) => {
		if (!(await projectExists(projectId, tx)))
			throw new NotFoundError(`project with id ${projectId} does not exist`);
		// the cap counts only persistent sandboxes: an ephemeral run never reaches
		// here, so it can run even when the user is already at the limit (#763)
		const max = maxSandboxesPerUser();
		if ((await countSandboxes(projectId, userId, tx)) >= max)
			throw new ConflictError(
				`You have reached the limit of ${max} sandboxes in this project. Delete one first.`,
			);
		const id = await insertSandbox(
			{
				projectId,
				userId,
				name: data.name,
				settings: { tracingEnabled: data.settings?.tracingEnabled ?? false },
			},
			tx,
		);
		await seedDefaultBlocks(id, tx, "sandbox");
		await audit.record({
			projectId,
			resourceType: "sandbox",
			resourceId: id,
			action: "create",
			changedFields: bodyFields(data),
		});
		return id;
	});
	await publishMessage(CHAN_ON_SANDBOX_CHANGE, id);
	return { id };
}

export async function listMySandboxes(projectId: string, userId: string) {
	return { data: (await listSandboxes(projectId, userId)).map(present) };
}

export async function getSandbox(projectId: string, id: string, userId: string) {
	return present(await mustOwn(projectId, id, userId));
}

export async function updateSandbox(
	projectId: string,
	id: string,
	userId: string,
	data: z.infer<typeof patchSchema>,
) {
	const updated = await db.transaction(async (tx) => {
		const existing = await mustOwn(projectId, id, userId, tx);
		const row = await updateSandboxRow(
			id,
			{
				name: data.name,
				settings: data.settings ? { ...existing.settings, ...data.settings } : undefined,
			},
			tx,
		);
		await audit.record({
			projectId,
			resourceType: "sandbox",
			resourceId: id,
			action: "update",
			changedFields: bodyFields(data),
		});
		return row;
	});
	// tracing is compiled into the artifact, so a settings change recompiles
	await publishMessage(CHAN_ON_SANDBOX_CHANGE, id);
	return present(updated);
}

/**
 * Blocks, edges, triggers and recordings go with the row; both development
 * artifacts and every trigger's are dropped here, so its consumers stop.
 */
export async function deleteSandbox(projectId: string, id: string, userId: string) {
	const triggerIds = await db.transaction(async (tx) => {
		await mustOwn(projectId, id, userId, tx);
		const triggers = await sandboxTriggerIds(id, tx);
		await deleteSandboxRow(id, tx);
		await audit.record({
			projectId,
			resourceType: "sandbox",
			resourceId: id,
			action: "delete",
			changedFields: [],
		});
		return triggers;
	});
	await dropSandbox(projectId, id);
	for (const triggerId of triggerIds)
		await deleteArtifactEverywhere(triggerKey(projectId, triggerId));
	return { id };
}

/**
 * Runs the sandbox as a workflow on a development worker, through the same
 * internal subject a workflow's Run button uses. Answers with the job id, not a
 * result: the run is recorded, and the recording is where its outcome is.
 */
export async function runSandbox(
	projectId: string,
	id: string,
	userId: string,
	body: z.infer<typeof runSchema>,
): Promise<z.infer<typeof runAcceptedSchema>> {
	await mustOwn(projectId, id, userId);
	// otherwise the run would wait on the queue for a worker nobody started
	if (!(await devWorkerOnline(projectId))) {
		throw new ConflictError("start a worker with FLUXIFY_ENV=development");
	}
	const fired = await fireInternalTrigger(
		{ projectId, workflowId: id, data: body.payload, origin: { via: "manual", userId } },
		"development",
	);
	return { id: fired.id, accepted: true };
}

function present(row: Sandbox): z.infer<typeof sandboxSchema> {
	return {
		id: row.id,
		projectId: row.projectId,
		name: row.name,
		settings: row.settings,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
