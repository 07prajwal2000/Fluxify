import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as natsLib from "@fluxify/common/nats";
import { RpcError } from "@fluxify/common/nats";
import type { PluginTriggerRef } from "../../requestRouter/pluginTriggers";

// read once when the env module loads, so before anything imports it
process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const dbNats = await import("../../../db/nats");
const { BadRequestError } = await import("../../../errors/badRequestError");
const { EncryptionService } = await import("../../../lib/encryption");
const { NO_DEV_WORKER_WARNING, runTriggerValidation } = await import("../validateDispatch");
const { serveTriggerValidation } = await import("../validateHost");

const ref = { projectId: "p1", kind: "acme/t/poll", integrity: "sha-1" } as PluginTriggerRef;
const payload = { projectId: "p1", kind: "acme/t/poll", integrity: "sha-1", source: { every: 5 } };

beforeEach(() => {
	mock.restore();
	spyOn(dbNats, "natsConnection").mockReturnValue({} as never);
});
afterEach(() => mock.restore());

describe("serveTriggerValidation", () => {
	let handler: (req: { sealed: string }) => Promise<string[]>;
	let validated: unknown[];
	const serve = (answer: () => Promise<string[]>) => {
		validated = [];
		const respond = spyOn(natsLib, "rpcRespond").mockImplementation(((
			_nc: unknown,
			_subject: string,
			h: typeof handler,
		) => {
			handler = h;
			return { stop: async () => {} };
		}) as never);
		serveTriggerValidation(
			"p1",
			"development",
			{ validateTrigger: async (request) => (validated.push(request), answer()) },
			() => [ref],
		);
		return respond;
	};
	const call = (body: object) =>
		handler({ sealed: EncryptionService.encrypt(JSON.stringify({ ...payload, ...body })) });

	it("answers on the project's development subject, one worker per request", () => {
		const respond = serve(async () => []);
		expect(respond.mock.calls[0]?.[1]).toBe("fluxify.dev.trigger-validate.p1");
		expect(respond.mock.calls[0]?.[3]).toEqual({ queue: "fluxify_trigger_validate" });
	});

	it("hands the settings to the execution process and returns its warnings", async () => {
		serve(async () => ["heavy"]);
		expect(await call({})).toEqual(["heavy"]);
		expect(validated).toEqual([{ projectId: "p1", kind: "acme/t/poll", source: { every: 5 } }]);
	});

	it("a kind not installed here, or at another version, is NOT_FOUND and never runs", async () => {
		serve(async () => []);
		for (const body of [{ kind: "acme/t/other" }, { integrity: "sha-2" }]) {
			const error = await call(body).catch((e) => e);
			expect(error.code).toBe("NOT_FOUND");
		}
		expect(validated).toEqual([]);
	});

	it("the author's error comes back as VALIDATION_FAILED, its message only", async () => {
		serve(async () => {
			throw new Error("every must be at most 60");
		});
		const error = await call({}).catch((e) => e);
		expect([error.code, error.message]).toEqual(["VALIDATION_FAILED", "every must be at most 60"]);
	});

	it("refuses a request for another project", async () => {
		serve(async () => []);
		expect((await call({ projectId: "p2" }).catch((e) => e)).code).toBe("FORBIDDEN");
	});
});

describe("runTriggerValidation", () => {
	const answer = (result: () => Promise<unknown>) =>
		spyOn(natsLib, "rpcRequest").mockImplementation((() => result()) as never);

	it("asks a development worker, sealed, and returns its warnings", async () => {
		const request = answer(async () => ["heavy"]);
		expect(await runTriggerValidation(payload)).toEqual(["heavy"]);
		const [, subject, body] = request.mock.calls[0] as unknown as [unknown, string, { sealed: string }];
		expect(subject).toBe("fluxify.dev.trigger-validate.p1");
		expect(JSON.parse(EncryptionService.decrypt(body.sealed))).toEqual(payload);
	});

	it("no development worker, or none with the version yet: saved with a warning", async () => {
		answer(async () => {
			throw new RpcError("NO_RESPONDERS", "no responders");
		});
		expect(await runTriggerValidation(payload)).toEqual([NO_DEV_WORKER_WARNING]);
		answer(async () => {
			throw new RpcError("NOT_FOUND", "not installed yet");
		});
		expect(await runTriggerValidation(payload)).toEqual([
			"not installed yet: skipped the trigger's validation",
		]);
	});

	it("the author's error and a timeout refuse the save as a 400", async () => {
		answer(async () => {
			throw new RpcError("VALIDATION_FAILED", "every must be at most 60");
		});
		const refused = await runTriggerValidation(payload).catch((e) => e);
		expect(refused).toBeInstanceOf(BadRequestError);
		expect(refused.message).toBe("every must be at most 60");
		answer(async () => {
			throw new RpcError("TIMEOUT", "timed out");
		});
		await expect(runTriggerValidation(payload)).rejects.toThrow(
			"No response from a development worker in",
		);
	});
});
