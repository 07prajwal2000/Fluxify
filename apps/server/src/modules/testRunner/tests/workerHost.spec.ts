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
const dbNats = { ...(await import("../../../db/nats")) };
mock.module("../../../db/nats", () => ({ ...dbNats, natsConnection: () => ({}) }));
const spawned: Array<{ bootstrap: any; entry: string }> = [];
const spawn = { ...(await import("../spawn")) };
mock.module("../spawn", () => ({
	...spawn,
	runSuiteInChild: async (bootstrap: any, entry: string) => {
		spawned.push({ bootstrap, entry });
		return { ok: true, status: 200 };
	},
}));

const { EncryptionService } = await import("../../../lib/encryption");
const { serveTestRuns } = await import("../workerHost");
const seal = (bootstrap: object) => EncryptionService.encrypt(JSON.stringify(bootstrap));

const mockRefs = [
	{
		projectId: "p1",
		type: "acme/echo/step",
		plugin: "acme/echo",
		version: "1.2.0+a1b2c3d4",
		integrity: "sha256-abc",
		entry: "/p1/echo.js",
		meta: { handles: { out: [] }, invoke: [] },
	},
	{
		projectId: "p1",
		type: "acme/other/step",
		plugin: "acme/other",
		version: "1.0.0",
		integrity: "sha256-def",
		entry: "/p1/other.js",
		meta: { handles: { out: [] }, invoke: [] },
	},
	{
		projectId: "p2",
		type: "acme/echo/step",
		plugin: "acme/echo",
		version: "1.2.0+a1b2c3d4",
		integrity: "sha256-abc",
		entry: "/p2/echo.js",
		meta: { handles: { out: [] }, invoke: [] },
	},
];

describe("serveTestRuns", () => {
	serveTestRuns("p1", "/worker/testExecutionProcess.js", () => mockRefs as any);

	it("shares one project's suites across its workers", () => {
		expect(subscribed).toEqual({ subject: "fluxify.tests.run.p1", queue: "fluxify_test_runners" });
	});

	it("unseals the suite and runs it in a fresh child", async () => {
		expect(await handler({ sealed: seal({ projectId: "p1" }) })).toEqual({ ok: true, status: 200 });
		expect(spawned[0]?.entry).toBe("/worker/testExecutionProcess.js");
		expect(spawned[0]?.bootstrap.projectId).toBe("p1");
	});

	it("refuses a suite sealed for another project", async () => {
		const error = await handler({ sealed: seal({ projectId: "p2" }) }).catch((e) => e);
		expect(error.code).toBe("FORBIDDEN");
		expect(spawned).toHaveLength(1);
	});

	it("passes only the needed refs for the suite's project and pluginBlocks to the child", async () => {
		const res = await handler({
			sealed: seal({
				projectId: "p1",
				pluginBlocks: ["acme/echo/step"],
				plugins: {
					"acme/echo": { version: "1.2.0", integrity: "sha256-abc" },
				},
			}),
		});
		expect(res).toEqual({ ok: true, status: 200 });
		const last = spawned[spawned.length - 1];
		expect(last?.bootstrap.pluginRefs).toHaveLength(1);
		expect(last?.bootstrap.pluginRefs[0].type).toBe("acme/echo/step");
		expect(last?.bootstrap.pluginRefs[0].projectId).toBe("p1");
	});

	it("fails with a clear error on version mismatch", async () => {
		const res = await handler({
			sealed: seal({
				projectId: "p1",
				pluginBlocks: ["acme/echo/step"],
				plugins: {
					"acme/echo": { version: "2.0.0", integrity: "sha256-other" },
				},
			}),
		});
		expect(res).toEqual({
			ok: false,
			error: "plugin acme/echo 2.0.0 isn't installed on this worker yet; retry when installation finishes",
			durationMs: 0,
		});
	});

	it("fails with a clear error on missing plugin", async () => {
		const res = await handler({
			sealed: seal({
				projectId: "p1",
				pluginBlocks: ["acme/missing/step"],
				plugins: {
					"acme/missing": { version: "1.0.0", integrity: "sha256-missing" },
				},
			}),
		});
		expect(res).toEqual({
			ok: false,
			error: "plugin acme/missing 1.0.0 isn't installed on this worker yet; retry when installation finishes",
			durationMs: 0,
		});
	});
});
