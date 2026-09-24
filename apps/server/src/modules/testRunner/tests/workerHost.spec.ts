import { describe, expect, it, mock } from "bun:test";

process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

let handler: (payload: { sealed: string }) => Promise<unknown>;
let subscribed: { subject: string; queue?: string } | undefined;
const nats = { ...(await import("@fluxify/common/nats")) };
mock.module("@fluxify/common/nats", () => ({
	...nats,
	rpcRespond: (_nc: unknown, subject: string, h: typeof handler, options: { queue?: string }) => {
		handler = h;
		subscribed = { subject, queue: options.queue };
		return { stop: async () => {} };
	},
}));
mock.module("../../../db/nats", () => ({ natsConnection: () => ({}) }));
const spawned: Array<{ projectId: string; entry: string }> = [];
mock.module("../spawn", () => ({
	runSuiteInChild: async (bootstrap: { projectId: string }, entry: string) => {
		spawned.push({ projectId: bootstrap.projectId, entry });
		return { ok: true, status: 200 };
	},
}));

const { EncryptionService } = await import("../../../lib/encryption");
const { serveTestRuns } = await import("../workerHost");
const seal = (bootstrap: object) => EncryptionService.encrypt(JSON.stringify(bootstrap));

describe("serveTestRuns", () => {
	serveTestRuns("p1", "/worker/testExecutionProcess.js");

	it("shares one project's suites across its workers", () => {
		expect(subscribed).toEqual({ subject: "fluxify.tests.run.p1", queue: "fluxify_test_runners" });
	});

	it("unseals the suite and runs it in a fresh child", async () => {
		expect(await handler({ sealed: seal({ projectId: "p1" }) })).toEqual({ ok: true, status: 200 });
		expect(spawned).toEqual([{ projectId: "p1", entry: "/worker/testExecutionProcess.js" }]);
	});

	it("refuses a suite sealed for another project", async () => {
		const error = await handler({ sealed: seal({ projectId: "p2" }) }).catch((e) => e);
		expect(error.code).toBe("FORBIDDEN");
		expect(spawned).toHaveLength(1);
	});
});
