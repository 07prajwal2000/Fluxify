import { DEFAULT_RESOURCES } from "../claimMetadata";
import { describe, expect, it } from "bun:test";
import {
	buildContainerSpec,
	containerNameFor,
	DEV_PATHS,
	EDGE_PRIORITY,
	LABELS,
	MANAGED_LABEL,
	nodeIdFor,
	type SpecOptions,
} from "../containerSpec";
import type { DesiredNode } from "../projection";

const CLAIM = "0192b1c4-1111-7000-8000-000000000001";
const PROJECT = "0192b1c4-2222-7000-8000-000000000002";
const GROUP = "0192b1c4-3333-7000-8000-000000000003";
const HOST = "shop.example.com";

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
		env: "production",
		resources: DEFAULT_RESOURCES,
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
		// Which assignment record it reads — the claim, not the node (#426)
		expect(env.FLUXIFY_CLAIM_ID).toBe(CLAIM);
		expect(env.WORKER_PROJECT_ID).toBe("*");
		expect(env.WORKER_MODE).toBe("both");
		expect(env.WORKER_GROUP_ID).toBe(GROUP);
		expect(env.NATS_URL).toBe("nats://nats:4222");
	});

	it("never passes the database on — a worker must not be able to reach it", () => {
		const env = envOf(buildContainerSpec(desired(), options));
		expect(env.PG_URL).toBeUndefined();
	});

	it("tells the worker which environment it serves, so its heartbeat can say so", () => {
		expect(envOf(buildContainerSpec(desired(), options)).FLUXIFY_ENV).toBe("production");
		expect(envOf(buildContainerSpec(desired({ env: "development" }), options)).FLUXIFY_ENV).toBe(
			"development",
		);
	});

	it("labels the environment, which is how a later pass notices the claim changed", () => {
		// FLUXIFY_ENV is fixed at creation, so the label is the only thing a pass
		// can compare against the claim — see `plan.immutableDrift`.
		expect(labelsOf(buildContainerSpec(desired(), options))[LABELS.env]).toBe("production");
		expect(
			labelsOf(buildContainerSpec(desired({ env: "development" }), options))[LABELS.env],
		).toBe("development");
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

	it("leaves a project-pinned node off the edge while it has no host", () => {
		const labels = labelsOf(buildContainerSpec(desired({ projectId: PROJECT }), options));
		expect(labels["traefik.enable"]).toBeUndefined();
		expect(labels[LABELS.project]).toBe(PROJECT);
	});

	it("routes a project-pinned node by its host, above the catch-all and below admin", () => {
		const labels = labelsOf(
			buildContainerSpec(desired({ projectId: PROJECT, host: "shop.example.com" }), options),
		);
		const router = `traefik.http.routers.fluxify-project-${PROJECT}`;
		expect(labels[`${router}.rule`]).toBe("Host(`shop.example.com`)");
		expect(labels[`${router}.priority`]).toBe("50");
		expect(labels[`${router}.service`]).toBe(`fluxify-project-${PROJECT}`);
		expect(labels[LABELS.host]).toBe("shop.example.com");
	});

	it("refuses a host that could break out of the Traefik rule", () => {
		expect(() =>
			buildContainerSpec(desired({ projectId: PROJECT, host: "a.com`) || PathPrefix(`/" }), options),
		).toThrow("malformed host");
	});

	it("lets Docker restart a dead container, rather than doing it from here", () => {
		const host = buildContainerSpec(desired(), options).body.HostConfig as Record<string, unknown>;
		expect(host.RestartPolicy).toEqual({ Name: "unless-stopped" });
		expect(host.NetworkMode).toBe("fluxify_net");
	});

	it("limits the container to its claim's size, and labels the size so a resize is seen", () => {
		const spec = buildContainerSpec(desired({ resources: { cpu: 1.5, memoryMb: 1024 } }), options);
		const host = spec.body.HostConfig as Record<string, unknown>;
		expect(host.NanoCpus).toBe(1_500_000_000);
		expect(host.Memory).toBe(1_073_741_824);
		expect((spec.body.Labels as Record<string, string>)[LABELS.resources]).toBe("1.5/1024");
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

/**
 * Every (environment, scope) pair the edge can be asked for (#742): the fixed
 * ordering of priorities only holds if all four are written from one place, and
 * a production and a development claim of the same project must never share a
 * router or a service.
 */
describe("the edge labels, per environment", () => {
	const labelsFor = (over: Partial<DesiredNode>) =>
		labelsOf(buildContainerSpec(desired(over), options));
	const routerOf = (labels: Record<string, string>, name: string) =>
		labels[`traefik.http.routers.${name}`];

	it("production catch-all: every path, at the bottom of the stack", () => {
		const labels = labelsFor({});
		expect(labels["traefik.http.routers.fluxify-worker.rule"]).toBe("PathPrefix(`/`)");
		expect(labels["traefik.http.routers.fluxify-worker.priority"]).toBe(
			String(EDGE_PRIORITY.prodCatchAll),
		);
	});

	it("production project: its own host, above the catch-all", () => {
		const labels = labelsFor({ projectId: PROJECT, host: HOST });
		expect(routerOf(labels, `fluxify-project-${PROJECT}.rule`)).toBe(`Host(\`${HOST}\`)`);
		expect(routerOf(labels, `fluxify-project-${PROJECT}.priority`)).toBe(
			String(EDGE_PRIORITY.prodProject),
		);
	});

	it("development catch-all: the dev paths alone, above the fixed worker-dev", () => {
		const labels = labelsFor({ env: "development" });
		const router = `traefik.http.routers.fluxify-worker-dev`;
		expect(labels[`${router}.rule`]).toBe(DEV_PATHS);
		expect(labels[`${router}.priority`]).toBe(String(EDGE_PRIORITY.devCatchAll));
		expect(labels[`${router}.service`]).toBe("fluxify-worker-dev");
		expect(labels["traefik.http.services.fluxify-worker-dev.loadbalancer.server.port"]).toBe("5600");
		// and it does not stand in for the production catch-all
		expect(labels["traefik.http.routers.fluxify-worker.rule"]).toBeUndefined();
	});

	it("development project: its own host with the dev paths, above everything else", () => {
		const labels = labelsFor({ env: "development", projectId: PROJECT, host: HOST });
		const router = `traefik.http.routers.fluxify-project-${PROJECT}-dev`;
		expect(labels[`${router}.rule`]).toBe(`Host(\`${HOST}\`) && (${DEV_PATHS})`);
		expect(labels[`${router}.priority`]).toBe(String(EDGE_PRIORITY.devProject));
		expect(labels[`${router}.service`]).toBe(`fluxify-project-${PROJECT}-dev`);
		// production's own router for that project is a different router entirely
		expect(labels[`traefik.http.routers.fluxify-project-${PROJECT}.rule`]).toBeUndefined();
	});

	it("keeps a project's production and development services apart, so neither is hidden", () => {
		const prod = labelsFor({ projectId: PROJECT, host: HOST });
		const dev = labelsFor({ projectId: PROJECT, host: HOST, env: "development" });
		const routers = (labels: Record<string, string>) =>
			Object.keys(labels)
				.filter((key) => key.endsWith(".rule"))
				.map((key) => key.replace("traefik.http.routers.", "").replace(".rule", ""));
		expect(routers(prod)).toEqual([`fluxify-project-${PROJECT}`]);
		expect(routers(dev)).toEqual([`fluxify-project-${PROJECT}-dev`]);
	});

	it("leaves a development workflow node off the edge, exactly like a production one", () => {
		const labels = labelsFor({ type: "workflow", env: "development" });
		expect(labels["traefik.enable"]).toBeUndefined();
	});
});
