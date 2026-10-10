import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { BadRequestError } from "../../../../errors/badRequestError";
import * as testConnService from "../../integrations/test-connection/service";
import { assertConnector, connectorProbers } from "../connectors";
import * as triggerRepo from "../repository";

let resolvedEnv: string | undefined;
let resolvedConfig: unknown;
let probeCalled = false;
let findIntegrationSpy: ReturnType<typeof spyOn>;
let resolveQueueConfigSpy: ReturnType<typeof spyOn>;
let natsProberSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	resolvedEnv = undefined;
	resolvedConfig = undefined;
	probeCalled = false;

	findIntegrationSpy = spyOn(triggerRepo, "findIntegration").mockImplementation(
		async (id: string) => {
			if (id === "missing") return undefined;
			if (id === "no-dev") {
				return {
					projectId: "p1",
					name: "prod_only_queue",
					group: "queue",
					variant: "NATS",
					config: { servers: "nats://prod:4222" },
					devConfig: null,
					syncDev: false,
				};
			}
			if (id === "synced-dev") {
				return {
					projectId: "p1",
					name: "synced_queue",
					group: "queue",
					variant: "NATS",
					config: { servers: "nats://prod:4222" },
					devConfig: null,
					syncDev: true,
				};
			}
			if (id === "has-dev") {
				return {
					projectId: "p1",
					name: "split_queue",
					group: "queue",
					variant: "NATS",
					config: { servers: "nats://prod:4222" },
					devConfig: { servers: "nats://dev:4222" },
					syncDev: false,
				};
			}
			return undefined;
		},
	);

	resolveQueueConfigSpy = spyOn(testConnService, "resolveQueueConfig").mockImplementation(
		async (_projectId: string, config: Record<string, unknown>, env: string) => {
			resolvedEnv = env;
			resolvedConfig = config;
			return config;
		},
	);

	natsProberSpy = spyOn(connectorProbers, "nats").mockImplementation(
		async (_config: any, stream: string) => {
			probeCalled = true;
			if (stream === "fail") throw new Error("stream not found");
		},
	);
});

afterEach(() => {
	findIntegrationSpy?.mockRestore();
	resolveQueueConfigSpy?.mockRestore();
	natsProberSpy?.mockRestore();
});

describe("assertConnector", () => {
	it("rejects an invalid source shape", async () => {
		expect(
			assertConnector({
				type: "nats",
				projectId: "p1",
				integrationId: "has-dev",
				source: {},
				probe: false,
			}),
		).rejects.toThrow(BadRequestError);
	});

	it("rejects a missing integration", async () => {
		expect(
			assertConnector({
				type: "nats",
				projectId: "p1",
				integrationId: "missing",
				source: { stream: "events" },
				probe: false,
			}),
		).rejects.toThrow(BadRequestError);
	});

	it("skips probe and returns a warning when dev integration value is missing", async () => {
		const warnings = await assertConnector({
			type: "nats",
			projectId: "p1",
			integrationId: "no-dev",
			source: { stream: "events" },
			probe: true,
		});
		expect(probeCalled).toBe(false);
		expect(resolvedEnv).toBeUndefined();
		expect(warnings.some((w) => w.includes("has no development value"))).toBe(true);
		expect(warnings.some((w) => w.includes("skipped probe"))).toBe(true);
	});

	it("probes with dev value when devConfig is present", async () => {
		const warnings = await assertConnector({
			type: "nats",
			projectId: "p1",
			integrationId: "has-dev",
			source: { stream: "events" },
			probe: true,
		});
		expect(probeCalled).toBe(true);
		expect(resolvedEnv).toBe("development");
		expect(resolvedConfig).toEqual({ servers: "nats://dev:4222" });
		expect(warnings).toEqual([]);
	});

	it("probes with prod value in dev mode when syncDev is true", async () => {
		const warnings = await assertConnector({
			type: "nats",
			projectId: "p1",
			integrationId: "synced-dev",
			source: { stream: "events" },
			probe: true,
		});
		expect(probeCalled).toBe(true);
		expect(resolvedEnv).toBe("development");
		expect(resolvedConfig).toEqual({ servers: "nats://prod:4222" });
		expect(warnings).toEqual([]);
	});

	it("turns broker probe errors into BadRequestError", async () => {
		expect(
			assertConnector({
				type: "nats",
				projectId: "p1",
				integrationId: "has-dev",
				source: { stream: "fail" },
				probe: true,
			}),
		).rejects.toThrow("stream not found");
	});
});
