import { describe, expect, it } from "bun:test";
import {
	buildContainerSpec,
	containerNameFor,
	LABELS,
	MANAGED_LABEL,
	nodeIdFor,
	type SpecOptions,
} from "../containerSpec";
import type { DesiredNode } from "../projection";

const CLAIM = "0192b1c4-1111-7000-8000-000000000001";
const PROJECT = "0192b1c4-2222-7000-8000-000000000002";
const GROUP = "0192b1c4-3333-7000-8000-000000000003";

const options: SpecOptions = {
	image: "fluxify-worker-compiled:latest",
	network: "fluxify_net",
	trafficPort: 5600,
	healthPort: 5601,
	passthroughEnv: { NATS_URL: "nats://nats:4222" },
};

function desired(overrides: Partial<DesiredNode> = {}): DesiredNode {
	return {
		claimId: CLAIM,
		replicaIndex: 0,
		projectId: null,
		type: "both",
		groupIds: [],
		excludedGroups: [],
		placeable: true,
		reason: null,
		...overrides,
	};
}

const envOf = (spec: { body: Record<string, unknown> }) =>
	Object.fromEntries(
		(spec.body.Env as string[]).map((entry) => {
			const at = entry.indexOf("=");
			return [entry.slice(0, at), entry.slice(at + 1)];
		}),
	);
const labelsOf = (spec: { body: Record<string, unknown> }) =>
	spec.body.Labels as Record<string, string>;

describe("nodeIdFor", () => {
	it("is derived, so a recreated container keeps the id its assignment is written under", () => {
		expect(nodeIdFor(CLAIM, 2)).toBe(`${CLAIM}.2`);
		// FLUXIFY_NODE_ID is capped at 50 characters
		expect(nodeIdFor(CLAIM, 99).length).toBeLessThanOrEqual(50);
	});

	it("names a container per replica, since two cannot share a name on one host", () => {
		expect(containerNameFor(CLAIM, 0)).not.toBe(containerNameFor(CLAIM, 1));
	});
});

describe("buildContainerSpec", () => {
	it("tells the worker who it is and what it serves", () => {
		const env = envOf(buildContainerSpec(desired({ groupIds: [GROUP] }), options));
		expect(env.FLUXIFY_NODE_ID).toBe(`${CLAIM}.0`);
		expect(env.WORKER_PROJECT_ID).toBe("*");
		expect(env.WORKER_MODE).toBe("both");
		expect(env.WORKER_GROUP_ID).toBe(GROUP);
		expect(env.NATS_URL).toBe("nats://nats:4222");
	});

	it("never passes the database on — a worker must not be able to reach it", () => {
		const env = envOf(buildContainerSpec(desired(), options));
		expect(env.PG_URL).toBeUndefined();
	});

	it("joins several groups into the one comma-separated variable the worker reads", () => {
		const groups = [GROUP, "0192b1c4-4444-7000-8000-000000000004"];
		expect(envOf(buildContainerSpec(desired({ groupIds: groups }), options)).WORKER_GROUP_ID).toBe(
			groups.join(","),
		);
	});

	it("labels the container as managed, which is the only reason it is ever touched again", () => {
		const labels = labelsOf(buildContainerSpec(desired({ replicaIndex: 1 }), options));
		expect(labels[MANAGED_LABEL]).toBe("orchestrator");
		expect(labels[LABELS.claim]).toBe(CLAIM);
		expect(labels[LABELS.replica]).toBe("1");
		expect(labels[LABELS.node]).toBe(`${CLAIM}.1`);
	});

	it("puts every catch-all node behind one Traefik service, so the edge balances across them", () => {
		const first = labelsOf(buildContainerSpec(desired(), options));
		const second = labelsOf(buildContainerSpec(desired({ replicaIndex: 1 }), options));
		expect(first["traefik.http.routers.fluxify-worker.rule"]).toBe("PathPrefix(`/`)");
		expect(second["traefik.http.services.fluxify-worker.loadbalancer.server.port"]).toBe(
			first["traefik.http.services.fluxify-worker.loadbalancer.server.port"],
		);
		// the probe must hit the supervisor's port, not the traffic port
		expect(first["traefik.http.services.fluxify-worker.loadbalancer.healthcheck.port"]).toBe("5601");
	});

	it("leaves a workflow node off the edge entirely — it serves no HTTP", () => {
		const labels = labelsOf(buildContainerSpec(desired({ type: "workflow" }), options));
		expect(labels["traefik.enable"]).toBeUndefined();
	});

	it("leaves a project-pinned node off the edge until subdomains exist (#340)", () => {
		const labels = labelsOf(buildContainerSpec(desired({ projectId: PROJECT }), options));
		expect(labels["traefik.enable"]).toBeUndefined();
		expect(labels[LABELS.project]).toBe(PROJECT);
	});

	it("lets Docker restart a dead container, rather than doing it from here", () => {
		const host = buildContainerSpec(desired(), options).body.HostConfig as Record<string, unknown>;
		expect(host.RestartPolicy).toEqual({ Name: "unless-stopped" });
		expect(host.NetworkMode).toBe("fluxify_net");
	});

	it("applies the pool's per-node budgets when the operator set them", () => {
		const host = buildContainerSpec(desired(), {
			...options,
			cpuPerNode: 1.5,
			memoryPerNodeMb: 1024,
		}).body.HostConfig as Record<string, unknown>;
		expect(host.NanoCpus).toBe(1_500_000_000);
		expect(host.Memory).toBe(1_073_741_824);
	});

	it("refuses an id that is not the shape the database generates", () => {
		// the socket is root-equivalent, so an id becomes a label, an environment
		// variable and part of a container name only after it is checked
		expect(() => buildContainerSpec(desired({ claimId: "../../etc" }), options)).toThrow();
		expect(() => buildContainerSpec(desired({ projectId: "'; drop" }), options)).toThrow();
		expect(() => buildContainerSpec(desired({ groupIds: ["$(whoami)"] }), options)).toThrow();
		expect(() => buildContainerSpec(desired({ replicaIndex: -1 }), options)).toThrow();
	});
});
