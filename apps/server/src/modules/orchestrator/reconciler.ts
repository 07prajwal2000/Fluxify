import { logger } from "@fluxify/common";
import { openKvBucket } from "@fluxify/common/nats";
import {
	type InfraProvider,
	type ObservedInventory,
	type ObservedNode,
	ORCHESTRATOR_LEASE_BUCKET,
	ORCHESTRATOR_LEASE_TTL_MS,
	orchestratorKeys,
} from "@fluxify/common/orchestrator";
import { initializeNats } from "../../db/nats";
import { type Assignments, openAssignments } from "./assignments";
import { readDesiredState } from "./desired";
import type { InfraDriver } from "./drivers/platform";
import type { DesiredNode } from "./projection";
import { recordEvent, syncNodeRows } from "./records";

/**
 * One pass of the control loop: read what should be running, look at what is,
 * and have the driver change the second to match the first.
 *
 * Everything here is the same on every platform — desired state, assignment
 * records, node rows, history and the published inventory. What differs is
 * behind `InfraDriver`, which reports the events it caused rather than writing
 * them, so no driver ever touches the database.
 */

export interface Reconciler {
	/** Runs one pass. Call it on a timer; it holds no state between passes. */
	once(): Promise<void>;
}

/**
 * Publishes the host's inventory for the app to read (§14.5).
 *
 * Desired state cannot answer "what is running": a container no claim asks for
 * is absent from it by definition, and that is exactly the one an operator
 * would open the Docker CLI to find. So what the pass observed is written where
 * admin can read it — in the lease bucket, so it expires with the lease and an
 * orchestrator that stopped reconciling stops reporting instead of leaving a
 * stale list behind.
 */
async function publishObserved(observed: readonly ObservedNode[], provider: InfraProvider) {
	try {
		const nc = await initializeNats();
		const bucket = await openKvBucket<ObservedInventory>(nc, ORCHESTRATOR_LEASE_BUCKET, {
			ttlMs: ORCHESTRATOR_LEASE_TTL_MS,
		});
		await bucket.put(orchestratorKeys.observed, {
			at: new Date().toISOString(),
			provider,
			nodes: observed.map((container) => ({ ...container })),
		});
	} catch (error) {
		// A pass that reconciled correctly must not be failed by a status write.
		logger.warn(`could not publish the host inventory: ${String(error)}`, "ORCHESTRATOR");
	}
}

export async function createReconciler(driver: InfraDriver): Promise<Reconciler> {
	const assignments = await openAssignments();

	return {
		async once() {
			const { nodes, pool, scaling } = await readDesiredState();
			const observed = await driver.observe();

			// Written before anything is created, so a new node finds its record
			// already there — and an existing node picks up a group change from
			// the same write without being restarted.
			await publishAssignments(nodes, assignments);

			for (const event of await driver.apply(nodes, observed, { pool, scaling })) {
				await recordEvent(event);
			}

			// Read back rather than assume: the rows then describe what the
			// platform actually holds, including a node that failed to start.
			const settled = await driver.observe();
			await syncNodeRows(nodes, settled);
			await publishObserved(settled, driver.provider);
		},
	};
}

/**
 * One record per claim, then a prune of everything else.
 *
 * Every replica of a claim carries the same type, groups and exclusions, so the
 * first placeable node of a claim describes all of them — writing per replica
 * stored the same bytes `r` times under keys no Deployment could ever produce.
 */
export async function publishAssignments(nodes: readonly DesiredNode[], assignments: Assignments) {
	const written = new Set<string>();
	for (const node of nodes) {
		if (!node.placeable || written.has(node.claimId)) continue;
		written.add(node.claimId);
		await assignments.write(node.claimId, {
			type: node.type,
			groupIds: node.groupIds,
			excludedGroups: node.excludedGroups,
		});
	}
	// Kept for every claim that still exists, not only the placeable ones: a
	// claim the license stopped allowing keeps its containers running (§12), and
	// pulling their record would have them fall back to their environment on the
	// next restart. Only a claim gone from desired state entirely loses it —
	// which is also what clears the per-node keys an older build wrote.
	await assignments.prune(new Set(nodes.map((node) => node.claimId)));
}
