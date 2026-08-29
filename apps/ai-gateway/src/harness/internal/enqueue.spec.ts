import { describe, it, expect, spyOn, mock, afterEach } from "bun:test";
import { ConflictError } from "@fluxify/server";
import * as queueModule from "../queue";
import { HarnessService } from "./harnessService";
import { RedisService } from "./redisService";
import { enqueueHarnessStart, enqueueHarnessContinue } from "./enqueue";

/** every publish this test file made: [subject, data, opts] */
function stubPublish() {
	const calls: Array<{ subject: string; data: any; opts: any }> = [];
	spyOn(queueModule, "publishHarnessJob").mockImplementation(
		async (subject: string, data: any, opts: any = {}) => {
			calls.push({ subject, data, opts });
		},
	);
	return calls;
}

afterEach(() => mock.restore());

describe("enqueueHarnessStart", () => {
	it("claims the conversation, then publishes the job with its key as the msg id", async () => {
		spyOn(HarnessService.prototype, "ensureConversation").mockResolvedValue("conv1");
		spyOn(HarnessService.prototype, "createRun").mockResolvedValue("run1");
		spyOn(RedisService.prototype, "setActiveRun").mockResolvedValue(undefined);
		const published = stubPublish();

		const result = await enqueueHarnessStart({
			conversationId: "conv1",
			query: "build me a route",
			metadata: { userId: "u1", projectId: "p1" },
		});

		expect(result).toEqual({ conversationId: "conv1", runId: "run1" });
		expect(published).toHaveLength(1);
		expect(published[0].subject).toBe("fluxify.harness.start.conv1");
		expect(published[0].data).toMatchObject({
			type: "start",
			conversationId: "conv1",
			runId: "run1",
			query: "build me a route",
		});
		// the id on the wire and the id in the payload must be the same value,
		// or the dedupe window guards nothing the logs can be traced back to
		expect(published[0].opts.msgId).toBe(published[0].data.idempotencyKey);
		expect(published[0].opts.msgId).toStartWith("start:run1:");
	});

	it("refuses and publishes nothing when the conversation claim is lost", async () => {
		spyOn(HarnessService.prototype, "ensureConversation").mockResolvedValue("conv1");
		spyOn(HarnessService.prototype, "createRun").mockResolvedValue(null);
		const published = stubPublish();

		expect(
			enqueueHarnessStart({ conversationId: "conv1", query: "hi" }),
		).rejects.toThrow(ConflictError);
		expect(published).toHaveLength(0);
	});

	it("gives two racing starts on one conversation two different msg ids", async () => {
		spyOn(HarnessService.prototype, "ensureConversation").mockResolvedValue("conv1");
		spyOn(RedisService.prototype, "setActiveRun").mockResolvedValue(undefined);
		const createRun = spyOn(HarnessService.prototype, "createRun");
		createRun.mockResolvedValueOnce("runA").mockResolvedValueOnce("runB");
		const published = stubPublish();

		await enqueueHarnessStart({ conversationId: "conv1", query: "a" });
		await enqueueHarnessStart({ conversationId: "conv1", query: "b" });

		expect(published[0].opts.msgId).not.toBe(published[1].opts.msgId);
	});
});

describe("enqueueHarnessContinue", () => {
	it("publishes on the continue subject once the parked conversation is claimed", async () => {
		spyOn(
			HarnessService.prototype,
			"claimConversationForContinue",
		).mockResolvedValue(true);
		const published = stubPublish();

		const result = await enqueueHarnessContinue({
			conversationId: "conv1",
			runId: "run1",
			action: { type: "approve" },
		});

		expect(result).toEqual({ conversationId: "conv1", runId: "run1" });
		expect(published[0].subject).toBe("fluxify.harness.continue.conv1");
		expect(published[0].data).toMatchObject({
			type: "continue",
			runId: "run1",
			action: { type: "approve" },
		});
		expect(published[0].opts.msgId).toStartWith("continue:run1:");
	});

	it("refuses when the run is no longer awaiting review", async () => {
		spyOn(
			HarnessService.prototype,
			"claimConversationForContinue",
		).mockResolvedValue(false);
		const published = stubPublish();

		expect(
			enqueueHarnessContinue({
				conversationId: "conv1",
				runId: "run1",
				action: { type: "approve" },
			}),
		).rejects.toThrow(ConflictError);
		expect(published).toHaveLength(0);
	});

	it("does not reuse the start key, so a continue is never eaten as a duplicate", async () => {
		spyOn(HarnessService.prototype, "ensureConversation").mockResolvedValue("conv1");
		spyOn(HarnessService.prototype, "createRun").mockResolvedValue("run1");
		spyOn(RedisService.prototype, "setActiveRun").mockResolvedValue(undefined);
		spyOn(
			HarnessService.prototype,
			"claimConversationForContinue",
		).mockResolvedValue(true);
		const published = stubPublish();

		await enqueueHarnessStart({ conversationId: "conv1", query: "hi" });
		await enqueueHarnessContinue({
			conversationId: "conv1",
			runId: "run1",
			action: { type: "approve" },
		});
		// and a second, legitimate HITL decision on the same run
		await enqueueHarnessContinue({
			conversationId: "conv1",
			runId: "run1",
			action: { type: "review", comments: ["tighten it"] },
		});

		const ids = published.map((p) => p.opts.msgId);
		expect(new Set(ids).size).toBe(3);
	});
});
