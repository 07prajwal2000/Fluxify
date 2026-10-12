import type { z } from "zod";
import { type DbTransactionType, db } from "../../db";
import type { AuthACL, CanvasVersionKind, GateResult } from "../../db/schema";
import { ConflictError } from "../../errors/conflictError";
import { ForbiddenError } from "../../errors/forbidError";
import { NotFoundError } from "../../errors/notFoundError";
import { canAccessProject } from "../../lib/acl";
import {
	findAuthor,
	findVersion,
	ownerOf,
	readTarget,
	versionNumberOf,
} from "../versions/repository";
import { announceChange, NOT_FOUND } from "../versions/targets";
import type { deployBodySchema } from "./dto";
import { runChecks } from "./gates";
import {
	findDeployment,
	finishDeployment,
	insertDeployment,
	listDeployments,
	pendingDeployments,
	setProdVersion,
} from "./repository";
import { planTests, testsGate } from "./testsGate";

/**
 * Promote and rollback (#739). A deployment is written `pending`, its gates
 * run, and it ends `live` (production now serves the version) or `failed` (the
 * gates say why). The quick gates run in the request. The tests gate takes as
 * long as the suites do, so when there are suites the request returns the
 * `pending` row and the rest finishes in the background: poll the deployment.
 *
 * Rollback is not a separate mechanism: it is a promote of a version older than
 * the one in production, and the log says which.
 */

/** a pending deployment older than this is a crashed one, not one in progress */
const STALE_PENDING_MS = 10 * 60_000;

type DeploymentRow = NonNullable<Awaited<ReturnType<typeof findDeployment>>>;

function present(row: DeploymentRow) {
	return {
		id: row.id,
		kind: row.kind,
		targetId: ownerOf(row),
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

	// 2. the quick gates, outside the transaction: they may take a while
	const gateTarget = {
		kind,
		id,
		projectId: started.projectId,
		versionId: started.deployment.versionId,
		snapshot: started.snapshot,
	};
	let quick: GateResult[];
	try {
		quick = await runChecks(gateTarget);
	} catch (error) {
		quick = [failedGate("compile", "The checks could not run", error)];
	}
	const quickPassed = !quick.some((gate) => gate.status === "failed");

	// 3. the tests gate, last; then finish. What it will run is worked out first,
	// so the request knows whether it has to wait for it.
	let plan: Awaited<ReturnType<typeof planTests>> | undefined;
	if (quickPassed) {
		try {
			plan = await planTests(gateTarget);
		} catch {
			// the gate plans again and reports it
		}
	}
	const finish = async () => {
		let tests: GateResult;
		try {
			tests = await testsGate(gateTarget, started.deployment.id, !quickPassed, plan);
		} catch (error) {
			tests = failedGate("tests", "The tests could not run", error);
		}
		const gates = [...quick, tests];
		const passed = !gates.some((gate) => gate.status === "failed");
		// production's pointer and the log move together
		await db.transaction(async (tx) => {
			await accessTarget(kind, id, acl, "creator", tx, true);
			if (passed) await setProdVersion(kind, id, started.deployment.versionId, tx);
			await finishDeployment(started.deployment.id, passed ? "live" : "failed", gates, tx);
		});
		// the usual change signal: the compiler republishes production from the new pointer
		if (passed) await announceChange(kind, id, started.projectId);
	};
	if (quickPassed && plan && plan.runs.length > 0) {
		// the request has its answer: pending, to be polled
		finish().catch((error) =>
			finishDeployment(started.deployment.id, "failed", [
				...quick,
				failedGate("tests", "The deployment could not finish", error),
			]).catch(() => {}),
		);
	} else {
		await finish();
	}
	return present((await findDeployment(kind, id, started.deployment.id))!);
}

function failedGate(gate: GateResult["gate"], what: string, error: unknown): GateResult {
	return {
		gate,
		status: "failed",
		message: `${what}: ${error instanceof Error ? error.message : String(error)}`,
	};
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
