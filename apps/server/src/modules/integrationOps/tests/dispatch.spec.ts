import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const nats = { ...(await import("@fluxify/common/nats")) };
const published: Array<{ subject: string; data: string }> = [];
let respond: (subject: string, payload: { sealed: string }, timeoutMs?: number) => Promise<unknown>;
mock.module("@fluxify/common/nats", () => ({
	...nats,
	publish: (_nc: unknown, subject: string, data: string) => published.push({ subject, data }),
	rpcRequest: (_nc: unknown, subject: string, payload: { sealed: string }, options: { timeoutMs?: number }) =>
		respond(subject, payload, options.timeoutMs),
}));
const dbNats = { ...(await import("../../../db/nats")) };
mock.module("../../../db/nats", () => ({ ...dbNats, natsConnection: () => ({}) }));
mock.module("../../../api/v1/integrations/test-connection/repository", () => ({
	getAppConfigs: async () => [],
}));

const { integrationRegistry } = await import("@fluxify/adapters/integrations");
const { EncryptionService } = await import("../../../lib/encryption");
const { integrationOpMode, runIntegrationOp } = await import("../dispatch");

const redis = { source: "credentials", host: "h", port: 6379 };
const target = { projectId: "p1", env: "development" as const, group: "kv", variant: "Redis", config: redis };

afterEach(() => mock.restore());

describe("integrationOpMode", () => {
	it("built-ins run here, anything else on a worker", () => {
		expect(integrationOpMode("kv", "Redis")).toBe("local");
		expect(integrationOpMode("acme/crm", "Hub")).toBe("worker");
		expect(integrationOpMode("kv", "NotInstalledHere")).toBe("worker");
	});

	it("a built-in can be sent to a worker; mcp never leaves", () => {
		expect(integrationOpMode("kv", "Redis", "worker")).toBe("worker");
		expect(integrationOpMode("mcp", "http", "worker")).toBe("local");
	});
});

describe("runIntegrationOp, local", () => {
	it("runs the def's hook in this process, never the bus", async () => {
		respond = async () => {
			throw new Error("must not be called");
		};
		const test = spyOn(integrationRegistry.require("kv", "Redis"), "test").mockResolvedValue({ success: true, error: "" });
		expect(await runIntegrationOp("test", { ...target, options: { signal: "logs" } })).toEqual({ success: true, error: "" });
		expect(test.mock.calls[0]?.[0]).toEqual(redis);
		expect((test.mock.calls[0]?.[1] as any).options).toEqual({ signal: "logs" });
	});
});

describe("runIntegrationOp, on a worker", () => {
	it("sends the call sealed on the env's subject, and answers with the worker's result", async () => {
		let sent: { subject: string; sealed: string } | undefined;
		respond = async (subject, { sealed }) => {
			sent = { subject, sealed };
			return { tables: [] };
		};
		const result = await runIntegrationOp(
			"inspect",
			{ ...target, integrationId: "i1", request: { key: "k" }, options: { oauth: { tokens: () => "x" } } },
			{ mode: "worker" },
		);
		expect(result).toEqual({ tables: [] });
		expect(sent!.subject).toBe("fluxify.dev.integrations.inspect.p1");
		const payload = JSON.parse(EncryptionService.decrypt(sent!.sealed));
		expect(payload).toEqual({
			opId: expect.any(String),
			projectId: "p1",
			integrationId: "i1",
			group: "kv",
			variant: "Redis",
			config: redis,
			request: { key: "k" },
			// a function never crosses
			options: { oauth: {} },
			timeoutMs: 10_000,
		});
	});

	it("production goes to production's subject, never development's", async () => {
		let subject = "";
		respond = async (s) => {
			subject = s;
			return { success: true };
		};
		await runIntegrationOp("test", { ...target, env: "production" }, { mode: "worker" });
		expect(subject).toBe("fluxify.integrations.test.p1");
	});

	it("no worker for the env is named, not a NATS error", async () => {
		respond = async () => {
			throw new nats.RpcError("NO_RESPONDERS", "none");
		};
		await expect(runIntegrationOp("test", target, { mode: "worker" })).rejects.toThrow(
			"No development worker is running for this project",
		);
	});

	it("a silent worker is a timeout with the env and the wait", async () => {
		respond = async () => {
			throw new nats.RpcError("TIMEOUT", "late");
		};
		await expect(runIntegrationOp("describe", { ...target, env: "production" }, { mode: "worker" })).rejects.toThrow(
			"No response from a production worker in 15s",
		);
	});

	it("an unknown variant and a hook failure come back as the worker's message", async () => {
		respond = async () => {
			throw new nats.RpcError("NOT_FOUND", 'Integration variant "acme/crm/Hub" is not installed on this development worker');
		};
		await expect(runIntegrationOp("test", { ...target, group: "acme/crm", variant: "Hub" })).rejects.toThrow(
			"is not installed on this development worker",
		);
		respond = async () => {
			throw new nats.RpcError("VALIDATION_FAILED", "ECONNREFUSED");
		};
		const error = await runIntegrationOp("test", target, { mode: "worker" }).catch((e) => e);
		expect(error.message).toBe("ECONNREFUSED");
		expect(error.name).toBe("IntegrationOpError");
	});
});

describe("runIntegrationOp, cancelled", () => {
	const hang = () => new Promise<never>(() => {});

	it("a local hook is told via ctx.signal and the op ends at once", async () => {
		let seen: AbortSignal | undefined;
		spyOn(integrationRegistry.require("kv", "Redis"), "test").mockImplementation(((_c: unknown, ctx: any) => {
			seen = ctx.signal;
			return hang();
		}) as never);
		const controller = new AbortController();
		const op = runIntegrationOp("test", target, { signal: controller.signal });
		setTimeout(() => controller.abort(), 20);
		await expect(op).rejects.toThrow("Cancelled");
		expect(seen?.aborted).toBe(true);
	});

	it("a worker op stops waiting and publishes its id on the project's cancel subject", async () => {
		let opId: string | undefined;
		respond = (_subject, { sealed }) => {
			opId = JSON.parse(EncryptionService.decrypt(sealed)).opId;
			return hang();
		};
		published.length = 0;
		const controller = new AbortController();
		const op = runIntegrationOp("test", target, { mode: "worker", signal: controller.signal });
		setTimeout(() => controller.abort(), 20);
		await expect(op).rejects.toThrow("Cancelled");
		expect(opId).toBeTruthy();
		expect(published).toEqual([{ subject: "fluxify.dev.integrations.cancel.p1", data: opId! }]);
	});

	it("an already cancelled op never reaches the bus", async () => {
		respond = async () => {
			throw new Error("must not be called");
		};
		published.length = 0;
		await expect(runIntegrationOp("test", target, { mode: "worker", signal: AbortSignal.abort() })).rejects.toThrow("Cancelled");
		expect(published).toEqual([]);
	});

	it("an op that finishes first leaves no cancel behind", async () => {
		respond = async () => ({ success: true });
		published.length = 0;
		const controller = new AbortController();
		await runIntegrationOp("test", target, { mode: "worker", signal: controller.signal });
		controller.abort();
		expect(published).toEqual([]);
	});
});
