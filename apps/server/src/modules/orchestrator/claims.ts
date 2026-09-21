import { logger } from "@fluxify/common";
import type { NodeType } from "@fluxify/common/orchestrator";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { nodeClaimsEntity, projectSettingsEntity, triggerGroupsEntity } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { NotFoundError } from "../../errors/notFoundError";
import { nodeEntitlement } from "../../lib/edition";
import { systemLog } from "../../lib/systemLogs";
import type { ClaimMetadata } from "./claimMetadata";
import { validateClaim } from "./projection";
import { recordEvent } from "./records";
import { scalingRefusal } from "./scaling";

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
	/** How far it may autoscale above `replicas`. Null (or absent) runs exactly `replicas`. */
	maxReplicas?: number | null;
	/** Optional settings (#429). Absent keys mean their defaults. */
	metadata?: ClaimMetadata;
}

export type ClaimPatch = Partial<
	Pick<ClaimInput, "type" | "groupIds" | "replicas" | "maxReplicas" | "metadata">
>;

/** A project owner may only touch their own project's claims. */
export interface ClaimScope {
	projectId?: string;
	/**
	 * The write came from instance settings (#423). An operator there sizes and
	 * retires a project's claim, but the groups it serves are the project's
	 * vocabulary and are edited on the project's own settings page — so both
	 * the group list and the type are refused from this surface.
	 */
	instance?: boolean;
}

const SUBDOMAIN_KEY = "settings.routing.subdomain";

/**
 * A project-pinned route node is reached by a `Host` rule built from the
 * project's subdomain, so without one there is nothing to route to it.
 */
export async function hasSubdomain(projectId: string | null): Promise<boolean> {
	if (projectId === null) return false;
	const [row] = await db
		.select({ value: projectSettingsEntity.value })
		.from(projectSettingsEntity)
		.where(
			and(
				eq(projectSettingsEntity.projectId, projectId),
				eq(projectSettingsEntity.key, SUBDOMAIN_KEY),
			),
		)
		.limit(1);
	return !!row?.value;
}

/** Every project's subdomain, for the edge labels the reconciler writes. */
export async function projectSubdomains(): Promise<Map<string, string>> {
	const rows = await db
		.select({ projectId: projectSettingsEntity.projectId, value: projectSettingsEntity.value })
		.from(projectSettingsEntity)
		.where(eq(projectSettingsEntity.key, SUBDOMAIN_KEY));
	return new Map(
		rows.filter((row) => row.projectId && row.value).map((row) => [row.projectId!, row.value]),
	);
}

/**
 * Whether the project has its own node serving APIs. Clearing its subdomain
 * would leave that node reachable by nothing, so it is refused while one exists.
 */
export async function hasRouteClaim(projectId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: nodeClaimsEntity.id })
		.from(nodeClaimsEntity)
		.where(
			and(
				eq(nodeClaimsEntity.projectId, projectId),
				inArray(nodeClaimsEntity.type, ["route", "both"]),
			),
		)
		.limit(1);
	return !!row;
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
	const entitlement = nodeEntitlement();
	const scaling = scalingRefusal(claim, entitlement);
	if (scaling) throw new BadRequestError(scaling);
	const result = validateClaim(claim, {
		entitlement,
		existingReplicas: await countClaimedReplicas(exceptClaimId),
		hasSubdomain: await hasSubdomain(claim.projectId),
	});
	// The refusal message is written for the person who asked, so it is passed
	// through rather than reworded: "this license allows 1 node and 1 is already
	// claimed" is the whole answer.
	if (!result.ok) throw new BadRequestError(result.message);
	await assertGroupsExist(claim.projectId, claim.groupIds);
}

/**
 * Whether the instance surface may write this patch (#423). A project's claim
 * is sized and released by the operator, but what it runs and which of that
 * project's trigger groups it serves are the project's own vocabulary and are
 * edited there — so the rule is a refusal, not a silently dropped field.
 *
 * Pure so it can be read and tested without a database; `updateClaim` is the
 * only caller.
 */
export function instancePatchRefusal(
	projectId: string | null,
	patch: ClaimPatch,
	scope: ClaimScope,
): string | null {
	if (!scope.instance || projectId === null) return null;
	if (!patch.groupIds && !patch.type) return null;
	return "What a project's claim runs and which trigger groups it serves are edited in that project's settings. From here you can change how many copies it runs, or release it.";
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
			maxReplicas: input.maxReplicas ?? null,
			metadata: input.metadata ?? {},
			createdBy: actor ?? null,
		})
		.returning();
	await recordEvent({
		claimId: claim!.id,
		projectId: claim!.projectId,
		action: "claim_created",
		detail: {
			type: input.type,
			groupIds: input.groupIds,
			replicas: input.replicas,
			maxReplicas: input.maxReplicas ?? null,
			metadata: input.metadata ?? {},
			actor,
		},
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
	const refusal = instancePatchRefusal(current.projectId, patch, scope);
	if (refusal) throw new BadRequestError(refusal);
	const next: ClaimInput = {
		projectId: current.projectId,
		type: patch.type ?? current.type,
		groupIds: patch.groupIds ?? current.groupIds,
		replicas: patch.replicas ?? current.replicas,
		// `null` in a patch clears the maximum, so only `undefined` keeps it.
		maxReplicas: patch.maxReplicas === undefined ? current.maxReplicas : patch.maxReplicas,
		// Per top-level key: a key the patch names is replaced whole, the rest are kept.
		metadata: { ...current.metadata, ...patch.metadata },
	};
	await assertValid(next, claimId);

	const [claim] = await db
		.update(nodeClaimsEntity)
		.set({
			type: next.type,
			groupIds: next.groupIds,
			replicas: next.replicas,
			maxReplicas: next.maxReplicas,
			metadata: next.metadata,
		})
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
			from: {
				type: current.type,
				groupIds: current.groupIds,
				replicas: current.replicas,
				maxReplicas: current.maxReplicas,
				metadata: current.metadata,
			},
			to: {
				type: next.type,
				groupIds: next.groupIds,
				replicas: next.replicas,
				maxReplicas: next.maxReplicas,
				metadata: next.metadata,
			},
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

export interface GroupRemoval {
	claim: typeof nodeClaimsEntity.$inferSelect;
	/** True when the group was the claim's last one, so it was scaled to zero. */
	drained: boolean;
}

/**
 * A trigger group is being deleted: take its id off every claim naming it, in
 * the caller's transaction. A claim left with no group has nothing to run, so
 * its replicas go to zero and the reconciler drains its nodes — including a
 * catch-all, where no groups would otherwise widen it to every group.
 */
export async function removeGroupFromClaims(
	groupId: string,
	tx: DbTransactionType,
): Promise<GroupRemoval[]> {
	const claims = await tx
		.select()
		.from(nodeClaimsEntity)
		// `?` with a text value, not `@> '[..]'::jsonb`: bun-sql binds a stringified
		// array as a jsonb *string*, which contains nothing.
		.where(sql`${nodeClaimsEntity.groupIds} ? ${groupId}`);

	const removals: GroupRemoval[] = [];
	for (const claim of claims) {
		const groupIds = claim.groupIds.filter((id) => id !== groupId);
		const drained = groupIds.length === 0;
		await tx
			.update(nodeClaimsEntity)
			// Its maximum goes too: a claim with nothing to run has no room to grow into.
			.set({
				groupIds,
				replicas: drained ? 0 : claim.replicas,
				maxReplicas: drained ? null : claim.maxReplicas,
			})
			.where(eq(nodeClaimsEntity.id, claim.id));
		removals.push({ claim, drained });
	}
	return removals;
}

/** History and system logs for `removeGroupFromClaims`, once its transaction has committed. */
export async function recordGroupRemoval(
	removals: GroupRemoval[],
	group: { id: string; name: string; projectId: string },
) {
	for (const { claim, drained } of removals) {
		await recordEvent({
			claimId: claim.id,
			projectId: claim.projectId,
			action: "claim_updated",
			reason: drained ? "draining" : null,
			detail: {
				cause: "group_deleted",
				groupId: group.id,
				from: { groupIds: claim.groupIds, replicas: claim.replicas },
				to: {
					groupIds: claim.groupIds.filter((id) => id !== group.id),
					replicas: drained ? 0 : claim.replicas,
				},
			},
		});
		if (!drained) continue;
		logger.info(
			`claim ${claim.id} drained: its last group ${group.id} was deleted`,
			"ORCHESTRATOR.claims",
		);
		await systemLog.warn({
			projectId: group.projectId,
			resourceType: "node_claim",
			resourceId: claim.id,
			type: "claim_drained",
			message: `Trigger group "${group.name}" was deleted and this claim served nothing else, so it was scaled to 0 and its nodes are draining`,
			detail: { groupId: group.id, replicas: claim.replicas },
		});
	}
}
