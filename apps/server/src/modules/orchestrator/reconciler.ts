import { logger } from "@fluxify/common";
import { openAssignments, type Assignments } from "./assignments";
import { buildContainerSpec, nodeIdFor, type SpecOptions } from "./containerSpec";
import { drainNode, listManagedNodes, startNode } from "./docker";
import { readDesiredState, type PoolLimits } from "./desired";
import { planReconcile, type PlanAction } from "./plan";
import type { DesiredNode } from "./projection";
import { recordEvent, syncNodeRows } from "./records";

/**
 * One pass of the control loop: read what should be running, look at what is,
 * and change the second to match the first.
 *
 * Only containers carrying this orchestrator's label are looked at, and the
 * daemon applies that filter — so a hand-started worker or an unrelated
 * container on a developer's machine is not merely spared, it is invisible.
 * That scoping is the thing standing between a reconcile loop and someone's
 * database container.
 *
 * A failing action is logged and recorded, never thrown: one image that will
 * not pull must not stop the other nodes in the same pass from being fixed.
 */

export interface ReconcileOptions {
	/** The only image a container is ever created from, straight from env. */
	image: string;
	network: string;
	trafficPort: number;
	healthPort: number;
	/**
	 * How long Docker waits after SIGTERM before SIGKILL. The worker drains
	 * in-flight work in that window (#336), so it is the worker's drain deadline
	 * plus a margin.
	 */
	drainTimeoutSec: number;
	/** Broker address, encryption key, log shipping — copied from this process. */
	passthroughEnv: Record<string, string>;
}

export interface Reconciler {
	/** Runs one pass. Call it on a timer; it holds no state between passes. */
	once(): Promise<void>;
}

export async function createReconciler(options: ReconcileOptions): Promise<Reconciler> {
	const assignments = await openAssignments();

	function specOptions(pool: PoolLimits): SpecOptions {
		return {
			image: options.image,
			network: options.network,
			trafficPort: options.trafficPort,
			healthPort: options.healthPort,
			cpuPerNode: pool.cpuPerNode,
			memoryPerNodeMb: pool.memoryPerNodeMb,
			passthroughEnv: options.passthroughEnv,
		};
	}

	async function create(node: DesiredNode, spec: SpecOptions, action: string, detail = {}) {
		const nodeId = nodeIdFor(node.claimId, node.replicaIndex);
		const containerId = await startNode(buildContainerSpec(node, spec));
		logger.info(`node ${nodeId} started as ${containerId.slice(0, 12)}`, "ORCHESTRATOR");
		await recordEvent({
			nodeId,
			claimId: node.claimId,
			projectId: node.projectId,
			action,
			detail: { ...detail, containerId },
		});
	}

	async function apply(action: PlanAction, spec: SpecOptions) {
		if (action.kind === "create") return create(action.node, spec, "created");

		if (action.kind === "remove") {
			const { container, reason } = action;
			await drainNode(container.containerId, options.drainTimeoutSec);
			// The record goes too: a node that no longer exists must not leave an
			// assignment behind for a future node with the same id to read.
			await assignments.remove(container.nodeId);
			logger.info(`node ${container.nodeId} removed (${reason})`, "ORCHESTRATOR");
			return recordEvent({
				nodeId: container.nodeId,
				claimId: container.claimId,
				projectId: container.projectId,
				action: "removed",
				reason: reason === "pool_unavailable" ? "pool_unavailable" : "draining",
				detail: { cause: reason },
			});
		}

		// ponytail: stop-then-start, so the node is briefly gone. A surge — start
		// the replacement, wait for ready, then drain the old one — needs a spare
		// license slot the cap does not allow, and community has one node anyway.
		// Revisit with the enterprise update path.
		await drainNode(action.container.containerId, options.drainTimeoutSec);
		await create(action.node, spec, "recreated", { why: action.why });
	}

	return {
		async once() {
			const { nodes, pool } = await readDesiredState();
			const observed = await listManagedNodes();
			const spec = specOptions(pool);

			// Written before anything is created, so a new container finds its
			// record already there — and an existing node picks up a group change
			// from the same write without being restarted.
			await publishAssignments(nodes, assignments);

			for (const action of planReconcile(nodes, observed, { image: options.image })) {
				try {
					await apply(action, spec);
				} catch (error) {
					logger.error(`${action.kind} failed: ${String(error)}`, "ORCHESTRATOR");
					if (action.kind !== "remove") {
						await recordEvent({
							nodeId: nodeIdFor(action.node.claimId, action.node.replicaIndex),
							claimId: action.node.claimId,
							projectId: action.node.projectId,
							action: `${action.kind}_failed`,
							reason: "start_failed",
							detail: { error: String(error) },
						});
					}
				}
			}

			// Read back rather than assume: the rows then describe what Docker
			// actually holds, including a container that failed to start.
			await syncNodeRows(nodes, await listManagedNodes());
		},
	};
}

async function publishAssignments(nodes: readonly DesiredNode[], assignments: Assignments) {
	for (const node of nodes) {
		if (!node.placeable) continue;
		await assignments.write(nodeIdFor(node.claimId, node.replicaIndex), {
			type: node.type,
			groupIds: node.groupIds,
			excludedGroups: node.excludedGroups,
		});
	}
}
