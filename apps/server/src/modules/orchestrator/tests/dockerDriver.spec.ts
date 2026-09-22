import { DEFAULT_RESOURCES } from "../claimMetadata";
import { describe, expect, it } from "bun:test";
import type { ObservedNode } from "@fluxify/common/orchestrator";
import { orchestrationScalingSchema } from "../../../lib/instance-settings/schemas";
import { containerNameFor } from "../containerSpec";
import { createDockerDriver, type DockerDriverOptions } from "../drivers/docker";
import type { DesiredNode } from "../projection";

/**
 * The driver reports what it did instead of recording it (#427), so the rule
 * worth a test is the one a reader would not notice breaking: a failed action
 * becomes an event and the rest of the pass still runs.
 */

const CLAIM = "0199a1b2-c3d4-7e5f-8a9b-000000000001";
const IMAGE = "fluxify-worker:test";

const options: DockerDriverOptions = {
	image: IMAGE,
	network: "fluxify_net",
	trafficPort: 5600,
	healthPort: 5601,
	drainTimeoutSec: 35,
	passthroughEnv: {},
	seedsDefaultClaim: true,
};

function node(replicaIndex: number): DesiredNode {
	return {
		claimId: CLAIM,
		replicaIndex,
		projectId: null,
		type: "both",
		groupIds: [],
		excludedGroups: [],
		resources: DEFAULT_RESOURCES,
		placeable: true,
		reason: null,
	};
}

function fakeApi(failOn: Set<string>) {
	const drained: string[] = [];
	return {
		drained,
		api: {
			dockerEndpoint: () => ({ base: "http://localhost", unix: "/var/run/docker.sock" }),
			dockerReachable: async () => true,
			listManagedNodes: async () => [],
			startNode: async (spec: { name: string }) => {
				if (failOn.has(spec.name)) throw new Error("docker failed (404): no such image");
				return `id-${spec.name}`;
			},
			drainNode: async (containerId: string) => {
				drained.push(containerId);
			},
		},
	};
}

const orphan: ObservedNode = {
	containerId: "stale",
	nodeId: `${CLAIM}.9`,
	claimId: CLAIM,
	replicaIndex: 9,
	projectId: null,
	image: IMAGE,
	running: true,
	platformState: "running",
};

describe("createDockerDriver", () => {
	it("turns a failed create into an event and still carries out the rest", async () => {
		const { api, drained } = fakeApi(new Set([containerNameFor(CLAIM, 0)]));
		const driver = createDockerDriver(options, api);
		const events = await driver.apply([node(0), node(1)], [orphan], {
			pool: { maxNodes: 10 },
			scaling: {
				policy: orchestrationScalingSchema.parse({}),
				ceilings: new Map(),
				triggersByGroup: new Map(),
			},
		});

		expect(drained).toEqual(["stale"]);
		expect(events.map((event) => event.action)).toEqual(["removed", "create_failed", "created"]);
		expect(events[1]).toMatchObject({ nodeId: `${CLAIM}.0`, reason: "start_failed" });
		expect(events[0]).toMatchObject({ reason: "draining", detail: { cause: "orphan" } });
	});

	it("describes itself for the lease", () => {
		const driver = createDockerDriver(options, fakeApi(new Set()).api);
		expect(driver.provider).toBe("docker");
		expect(driver.meta).toMatchObject({ endpoint: "/var/run/docker.sock", workerImage: IMAGE });
	});
});
