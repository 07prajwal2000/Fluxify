import type { z } from "zod";
import { type DbTransactionType, db } from "../../db";
import { CHAN_ON_ROUTE_CHANGE, CHAN_ON_WORKFLOW_CHANGE, publishMessage } from "../../db/redis";
import type { AuthACL, CanvasVersionKind, GateResult } from "../../db/schema";
import { ConflictError } from "../../errors/conflictError";
import { ForbiddenError } from "../../errors/forbidError";
import { NotFoundError } from "../../errors/notFoundError";
import { canAccessProject } from "../../lib/acl";
import { findAuthor, findVersion, readTarget, versionNumberOf } from "../versions/repository";
import type { deployBodySchema } from "./dto";
import { runGates } from "./gates";
import {
	findDeployment,
	finishDeployment,
	insertDeployment,
	listDeployments,
	pendingDeployments,
	setProdVersion,
} from "./repository";

/**
 * Promote and rollback (#739). A deployment is written `pending`, its gates
 * run, and it ends `live` (production now serves the version) or `failed` (the
 * gates say why). The gates run in the request today; the row is what a slower
 * gate, such as a test run, would be polled through.
 *
 * Rollback is not a separate mechanism: it is a promote of a version older than
 * the one in production, and the log says which.
 */

const NOT_FOUND = { route: "Route not found", workflow: "Workflow not found" } as const;
const CHANGE_CHANNEL = { route: CHAN_ON_ROUTE_CHANGE, workflow: CHAN_ON_WORKFLOW_CHANGE } as const;
/** a pending deployment older than this is a crashed one, not one in progress */
const STALE_PENDING_MS = 10 * 60_000;

type DeploymentRow = NonNullable<Awaited<ReturnType<typeof findDeployment>>>;

function present(row: DeploymentRow) {
	return {
		id: row.id,
		kind: row.kind,
		targetId: (row.routeId ?? row.workflowId)!,
		versionId: row.versionId,
		versionNumber: row.versionNumber,
		action: row.action,
		description: row.description,
		author: row.authorName ?? row.authorEmail,
		authorEmail: row.authorEmail,
		status: row.status,
		gates: row.gates,
		createdAt: row.createdAt.toISOString(),
		finishedAt: row.finishedAt?.toISOString() ?? null,
	};
}

async function accessTarget(
	kind: CanvasVersionKind,
	id: string,
	acl: AuthACL[],
	role: "viewer" | "creator",
	tx?: DbTransactionType,
	lock = false,
) {
	const target = await readTarget(kind, id, tx, lock);
	if (!target) throw new NotFoundError(NOT_FOUND[kind]);
	if (!canAccessProject(acl, target.projectId!, role)) throw new ForbiddenError();
	return target;
}

/**
 * Promotes or rolls back. Returns the deployment whatever the gates said: a
 * failed one is a normal answer, with the reasons in `gates`.
 */
export async function deployVersion(
	kind: CanvasVersionKind,
	id: string,
	input: z.infer<typeof deployBodySchema>,
	userId: string | undefined,
	acl: AuthACL[],
) {
	// 1. record the attempt, under the row lock, so two never run side by side
	const started = await db.transaction(async (tx) => {
		const target = await accessTarget(kind, id, acl, "creator", tx, true);
		const version = await findVersion(kind, id, input.versionId, tx);
		if (!version) throw new NotFoundError("Version not found");
		if (target.prodVersionId === version.id)
			throw new ConflictError(`v${version.versionNumber} is already live in production`);

		const unfinished = await pendingDeployments(kind, id, tx);
		const busy = unfinished.some((d) => Date.now() - d.createdAt.getTime() < STALE_PENDING_MS);
		if (busy) throw new ConflictError("A deployment is already in progress");
		for (const stale of unfinished)
			await finishDeployment(
				stale.id,
				"failed",
				[{ gate: "compile", status: "failed", message: "The deployment never finished" }],
				tx,
			);

		const currentNumber = await versionNumberOf(target.prodVersionId, tx);
		const author = await findAuthor(userId, tx);
		const deployment = await insertDeployment(
			{
				kind,
				targetId: id,
				projectId: target.projectId!,
				versionId: version.id,
				action:
					currentNumber !== null && version.versionNumber < currentNumber ? "rollback" : "promote",
				description: input.description,
				authorId: author?.id ?? null,
				authorEmail: author?.email ?? null,
			},
			tx,
		);
		return { deployment, snapshot: version.snapshot, projectId: target.projectId! };
	});

	// 2. the gates, outside the transaction: they may take a while
	let gates: GateResult[];
	try {
		gates = await runGates({ kind, id, projectId: started.projectId, snapshot: started.snapshot });
	} catch (error) {
		gates = [
			{
				gate: "compile",
				status: "failed",
				message: `The checks could not run: ${error instanceof Error ? error.message : String(error)}`,
			},
		];
	}
	const passed = !gates.some((gate) => gate.status === "failed");

	// 3. finish: production's pointer and the log move together
	await db.transaction(async (tx) => {
		await accessTarget(kind, id, acl, "creator", tx, true);
		if (passed) await setProdVersion(kind, id, started.deployment.versionId, tx);
		await finishDeployment(started.deployment.id, passed ? "live" : "failed", gates, tx);
	});
	// the usual change signal: the compiler republishes production from the new pointer
	if (passed) await publishMessage(CHANGE_CHANNEL[kind], id);

	return present((await findDeployment(kind, id, started.deployment.id))!);
}

export async function listTargetDeployments(kind: CanvasVersionKind, id: string, acl: AuthACL[]) {
	await accessTarget(kind, id, acl, "viewer");
	return { deployments: (await listDeployments(kind, id)).map(present) };
}

export async function getTargetDeployment(
	kind: CanvasVersionKind,
	id: string,
	deploymentId: string,
	acl: AuthACL[],
) {
	await accessTarget(kind, id, acl, "viewer");
	const row = await findDeployment(kind, id, deploymentId);
	if (!row) throw new NotFoundError("Deployment not found");
	return present(row);
}
