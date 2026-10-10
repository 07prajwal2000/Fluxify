import type { z } from "zod";
import { type DbTransactionType, db } from "../../../db";
import { CHAN_ON_SANDBOX_CHANGE, publishMessage } from "../../../db/redis";
import { ConflictError } from "../../../errors/conflictError";
import { NotFoundError } from "../../../errors/notFoundError";
import { dropSandbox } from "../../../modules/compiler/sandbox";
import { devWorkerOnline } from "../../../modules/orchestrator/status";
import { fireInternalTrigger } from "../../../modules/triggers/publisher";
import type { runAcceptedSchema, runSchema } from "../workflows/dto";
import { projectExists, seedDefaultBlocks } from "../workflows/repository";
import type { createSchema, patchSchema, sandboxSchema } from "./dto";
import {
	deleteSandboxRow,
	findSandbox,
	insertSandbox,
	listSandboxes,
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
export async function mustOwn(
	projectId: string,
	id: string,
	userId: string,
	tx?: DbTransactionType,
) {
	const sandbox = await findSandbox(id, tx);
	if (!sandbox || sandbox.projectId !== projectId || sandbox.userId !== userId) {
		throw new NotFoundError("Sandbox not found");
	}
	return sandbox;
}

export async function createSandbox(
	projectId: string,
	userId: string,
	data: z.infer<typeof createSchema>,
) {
	const id = await db.transaction(async (tx) => {
		if (!(await projectExists(projectId, tx)))
			throw new NotFoundError(`project with id ${projectId} does not exist`);
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
		return await updateSandboxRow(
			id,
			{
				name: data.name,
				settings: data.settings ? { ...existing.settings, ...data.settings } : undefined,
			},
			tx,
		);
	});
	// tracing is compiled into the artifact, so a settings change recompiles
	await publishMessage(CHAN_ON_SANDBOX_CHANGE, id);
	return present(updated);
}

/** Blocks, edges and recordings go with the row; both development artifacts are dropped here. */
export async function deleteSandbox(projectId: string, id: string, userId: string) {
	await db.transaction(async (tx) => {
		await mustOwn(projectId, id, userId, tx);
		await deleteSandboxRow(id, tx);
	});
	await dropSandbox(projectId, id);
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
