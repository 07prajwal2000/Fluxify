import { describe, expect, it, mock } from "bun:test";

process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const nats = { ...(await import("@fluxify/common/nats")) };
let respond: (subject: string, payload: { sealed: string }) => Promise<unknown>;
mock.module("@fluxify/common/nats", () => ({
	...nats,
	rpcRequest: (_nc: unknown, subject: string, payload: { sealed: string }) =>
		respond(subject, payload),
}));
const dbNats = { ...(await import("../../../db/nats")) };
mock.module("../../../db/nats", () => ({ ...dbNats, natsConnection: () => ({}) }));

const { EncryptionService } = await import("../../../lib/encryption");
const { runSuiteOnWorker } = await import("../dispatch");
const bootstrap = { projectId: "p1", timeoutMs: 1_000 } as any;

describe("runSuiteOnWorker", () => {
	it("sends the suite sealed, on the project's subject", async () => {
		let sent: { subject: string; sealed: string } | undefined;
		respond = async (subject, { sealed }) => {
			sent = { subject, sealed };
			return { ok: true };
		};
		expect(await runSuiteOnWorker(bootstrap)).toEqual({ ok: true } as any);
		expect(sent!.subject).toBe("fluxify.tests.run.p1");
		expect(JSON.parse(EncryptionService.decrypt(sent!.sealed))).toEqual(bootstrap);
	});

	it("fails the suite at once when no worker serves the project", async () => {
		respond = async () => {
			throw new nats.RpcError("NO_RESPONDERS", "none");
		};
		const result = await runSuiteOnWorker(bootstrap);
		expect(result).toMatchObject({ ok: false, error: expect.stringContaining("No worker") });
		expect("timedOut" in result).toBe(false);
	});

	it("reports a worker that never answers as a timeout", async () => {
		respond = async () => {
			throw new nats.RpcError("TIMEOUT", "late");
		};
		expect(await runSuiteOnWorker(bootstrap)).toMatchObject({ ok: false, timedOut: true });
	});
});
