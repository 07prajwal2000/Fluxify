import { logger } from "@fluxify/common";
import type { NodeType } from "@fluxify/common/orchestrator";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { nodeClaimsEntity, triggerGroupsEntity } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { NotFoundError } from "../../errors/notFoundError";
import { nodeEntitlement } from "../../lib/edition";
import { validateClaim } from "./projection";
import { recordEvent } from "./records";

/**
 * Writing claims — the only orchestration table admin owns (§2). The
 * orchestrator reads these rows and writes node rows; neither writes the
 * other's.
 *
 * One claim is one workload: a type, the trigger groups it serves and how many
 * identical replicas of it to run. Several claims per project is the normal
 * shape, because a project's API and a project's slow queue are different
 * workloads that want different amounts of capacity.
 *
 * Nothing here talks to Docker. A claim is a row; a container appears because
 * the reconciler noticed the row on its next pass, and disappears the same way.
 * That is also what makes a release safe to serve from an HTTP handler: the
 * drain happens in the orchestrator, under its lease, not inside this request.
 */

export interface ClaimInput {
	/** Null is the catch-all — every project. Only a system admin may write one. */
	projectId: string | null;
	type: NodeType;
	groupIds: string[];
	replicas: number;
}

export type ClaimPatch = Partial<Pick<ClaimInput, "type" | "groupIds" | "replicas">>;

/** A project owner may only touch their own project's claims. */
export interface ClaimScope {
	projectId?: string;
}

/**
 * Subdomains are #340, so no project has one yet and a project-pinned claim
 * that needs routing is refused with that as the reason. Written as a function
 * rather than a literal `false` so #340 has one obvious place to land.
 */
export async function hasSubdomain(_projectId: string | null): Promise<boolean> {
	return false;
}

/** Replicas already claimed instance-wide — what the license counts (§7). */
export async function countClaimedReplicas(exceptClaimId?: string): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`coalesce(sum(${nodeClaimsEntity.replicas}), 0)::int` })
		.from(nodeClaimsEntity)
		.where(exceptClaimId ? sql`${nodeClaimsEntity.id} <> ${exceptClaimId}` : undefined);
	return row?.total ?? 0;
}

/** Groups have to exist, and a project's claim may only name that project's. */
async function assertGroupsExist(projectId: string | null, groupIds: string[]) {
	if (groupIds.length === 0) return;
	const rows = await db
		.select({ id: triggerGroupsEntity.id })
		.from(triggerGroupsEntity)
		.where(
			projectId === null
				? inArray(triggerGroupsEntity.id, groupIds)
				: and(
						inArray(triggerGroupsEntity.id, groupIds),
						eq(triggerGroupsEntity.projectId, projectId),
					),
		);
	const found = new Set(rows.map((row) => row.id));
	const missing = groupIds.filter((id) => !found.has(id));
	if (missing.length)
		throw new BadRequestError(
			`These trigger groups do not belong to this project: ${missing.join(", ")}`,
		);
}

async function assertValid(claim: ClaimInput, exceptClaimId?: string) {
	const result = validateClaim(claim, {
		entitlement: nodeEntitlement(),
		existingReplicas: await countClaimedReplicas(exceptClaimId),
		hasSubdomain: await hasSubdomain(claim.projectId),
	});
	// The refusal message is written for the person who asked, so it is passed
	// through rather than reworded: "this license allows 1 node and 1 is already
	// claimed" is the whole answer.
	if (!result.ok) throw new BadRequestError(result.message);
	await assertGroupsExist(claim.projectId, claim.groupIds);
}

async function loadClaim(claimId: string, scope: ClaimScope) {
	const [claim] = await db
		.select()
		.from(nodeClaimsEntity)
		.where(
			scope.projectId
				? and(eq(nodeClaimsEntity.id, claimId), eq(nodeClaimsEntity.projectId, scope.projectId))
				: eq(nodeClaimsEntity.id, claimId),
		)
		.limit(1);
	if (!claim) throw new NotFoundError("Claim not found");
	return claim;
}

export async function createClaim(input: ClaimInput, actor?: string) {
	await assertValid(input);
	const [claim] = await db
		.insert(nodeClaimsEntity)
		.values({
			projectId: input.projectId,
			type: input.type,
			groupIds: input.groupIds,
			replicas: input.replicas,
			createdBy: actor ?? null,
		})
		.returning();
	await recordEvent({
		claimId: claim!.id,
		projectId: claim!.projectId,
		action: "claim_created",
		detail: { type: input.type, groupIds: input.groupIds, replicas: input.replicas, actor },
	});
	logger.info(
		`claim ${claim!.id} created: ${input.type}, ${input.replicas} replica(s)`,
		"ORCHESTRATOR.claims",
	);
	return claim!;
}

/**
 * Changing a claim, which is three different consequences wearing one verb:
 * type and groups reach a running node through the KV assignment it watches, so
 * they apply in place; the replica count adds or removes containers. Which one
 * a change is belongs in the event detail, because a person reading the history
 * later cannot tell from the numbers alone.
 *
 * A claim's **project is not patchable**. It is baked into the container's env
 * and Traefik labels, so moving it would be a delete and a create with a new
 * node identity — which is exactly what releasing the claim and making another
 * one already is, without a second code path that looks like an edit.
 */
export async function updateClaim(claimId: string, patch: ClaimPatch, scope: ClaimScope = {}) {
	const current = await loadClaim(claimId, scope);
	const next: ClaimInput = {
		projectId: current.projectId,
		type: patch.type ?? current.type,
		groupIds: patch.groupIds ?? current.groupIds,
		replicas: patch.replicas ?? current.replicas,
	};
	await assertValid(next, claimId);

	const [claim] = await db
		.update(nodeClaimsEntity)
		.set({ type: next.type, groupIds: next.groupIds, replicas: next.replicas })
		.where(eq(nodeClaimsEntity.id, claimId))
		.returning();

	const scaledBy = next.replicas - current.replicas;
	await recordEvent({
		claimId,
		projectId: current.projectId,
		action: "claim_updated",
		detail: {
			appliedLive: next.type !== current.type || patch.groupIds !== undefined,
			scaledBy,
			from: { type: current.type, groupIds: current.groupIds, replicas: current.replicas },
			to: { type: next.type, groupIds: next.groupIds, replicas: next.replicas },
		},
	});
	return claim!;
}

/**
 * Releasing a claim. The row goes, its node rows cascade with it, and on the
 * next pass the containers are no longer in desired state — so the orchestrator
 * drains and removes them, which is the same path a scale-down takes.
 *
 * That is the rollback: nothing here stops a container. Desired state shrinks,
 * and the loop makes the host agree with it under the license and pool limits
 * that were already in force.
 */
export async function releaseClaim(claimId: string, scope: ClaimScope = {}) {
	const claim = await loadClaim(claimId, scope);
	await db.delete(nodeClaimsEntity).where(eq(nodeClaimsEntity.id, claimId));
	await recordEvent({
		claimId,
		projectId: claim.projectId,
		action: "claim_released",
		reason: "draining",
		detail: { type: claim.type, replicas: claim.replicas, groupIds: claim.groupIds },
	});
	logger.info(`claim ${claimId} released — its nodes will drain`, "ORCHESTRATOR.claims");
	return { id: claimId };
}
