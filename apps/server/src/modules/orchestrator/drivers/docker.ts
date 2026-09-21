import { logger } from "@fluxify/common";
import { buildContainerSpec, nodeIdFor, type SpecOptions } from "../containerSpec";
import { type PlanAction, planReconcile } from "../plan";
import type { DesiredNode } from "../projection";
import type { NodeEvent } from "../records";
import * as dockerApi from "./dockerApi";
import type { InfraDriver } from "./platform";

/**
 * Docker as a driver: one container per replica, planned per node by
 * `plan.ts` and carried out through `dockerApi.ts`.
 *
 * Only containers carrying this orchestrator's label are looked at, and the
 * daemon applies that filter — so a hand-started worker or an unrelated
 * container on a developer's machine is not merely spared, it is invisible.
 * That scoping is the thing standing between a reconcile loop and someone's
 * database container.
 */

export interface DockerDriverOptions {
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
	seedsDefaultClaim: boolean;
}

type DockerApi = Pick<
	typeof dockerApi,
	"dockerEndpoint" | "dockerReachable" | "listManagedNodes" | "startNode" | "drainNode"
>;

export function createDockerDriver(
	options: DockerDriverOptions,
	api: DockerApi = dockerApi,
): InfraDriver {
	const endpoint = api.dockerEndpoint();

	async function create(node: DesiredNode, spec: SpecOptions, action: string, detail = {}) {
		const nodeId = nodeIdFor(node.claimId, node.replicaIndex);
		const containerId = await api.startNode(buildContainerSpec(node, spec));
		logger.info(`node ${nodeId} started as ${containerId.slice(0, 12)}`, "ORCHESTRATOR");
		return {
			nodeId,
			claimId: node.claimId,
			projectId: node.projectId,
			action,
			detail: { ...detail, containerId },
		};
	}

	async function perform(action: PlanAction, spec: SpecOptions): Promise<NodeEvent> {
		if (action.kind === "create") return create(action.node, spec, "created");

		if (action.kind === "remove") {
			const { container, reason } = action;
			await api.drainNode(container.containerId, options.drainTimeoutSec);
			logger.info(`node ${container.nodeId} removed (${reason})`, "ORCHESTRATOR");
			return {
				nodeId: container.nodeId,
				claimId: container.claimId,
				projectId: container.projectId,
				action: "removed",
				reason: reason === "pool_unavailable" ? "pool_unavailable" : "draining",
				detail: { cause: reason },
			};
		}

		// ponytail: stop-then-start, so the node is briefly gone. A surge — start
		// the replacement, wait for ready, then drain the old one — needs a spare
		// license slot the cap does not allow, and community has one node anyway.
		// Revisit with the enterprise update path.
		await api.drainNode(action.container.containerId, options.drainTimeoutSec);
		return create(action.node, spec, "recreated", { why: action.why });
	}

	return {
		provider: "docker",
		meta: {
			endpoint: endpoint.unix ?? endpoint.base,
			workerImage: options.image,
			network: options.network,
			seedsDefaultClaim: options.seedsDefaultClaim,
		},
		reachable: api.dockerReachable,
		observe: api.listManagedNodes,

		async apply(desired, observed, { pool }) {
			const spec: SpecOptions = {
				image: options.image,
				network: options.network,
				trafficPort: options.trafficPort,
				healthPort: options.healthPort,
				cpuPerNode: pool.cpuPerNode,
				memoryPerNodeMb: pool.memoryPerNodeMb,
				passthroughEnv: options.passthroughEnv,
			};
			const events: NodeEvent[] = [];
			for (const action of planReconcile(desired, observed, { image: options.image })) {
				try {
					events.push(await perform(action, spec));
				} catch (error) {
					logger.error(`${action.kind} failed: ${String(error)}`, "ORCHESTRATOR");
					if (action.kind === "remove") continue;
					events.push({
						nodeId: nodeIdFor(action.node.claimId, action.node.replicaIndex),
						claimId: action.node.claimId,
						projectId: action.node.projectId,
						action: `${action.kind}_failed`,
						reason: "start_failed",
						detail: { error: String(error) },
					});
				}
			}
			return events;
		},
	};
}
