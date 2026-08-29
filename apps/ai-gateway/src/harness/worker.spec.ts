import { describe, it, expect, spyOn, mock, afterEach } from "bun:test";
import type { QueueMessage } from "@fluxify/common/nats";
import { FluxifyHarness } from "./index";
import { HarnessService } from "./internal/harnessService";
import * as projectConfig from "./models/projectConfig";
import { __runJob, __releaseRun } from "./worker";
import type { HarnessJobData } from "./queue";

const job = (data: Partial<HarnessJobData>): QueueMessage<HarnessJobData> =>
	({
		subject: "fluxify.harness.start.conv1",
		data: {
			type: "start",
			conversationId: "conv1",
			runId: "run1",
			metadata: { projectId: "p1" },
			...data,
		} as HarnessJobData,
		msg: {} as any,
	}) as QueueMessage<HarnessJobData>;

/** Stubs everything past the claim so a claimed job doesn't reach a model. */
function stubHarness() {
	spyOn(projectConfig, "resolveAgentOptionsFromProjectId").mockResolvedValue(
		{} as any,
	);
	spyOn(projectConfig, "resolveAgentOptionsFromIntegrationId").mockReturnValue(
		{} as any,
	);
	return {
		start: spyOn(FluxifyHarness.prototype, "start").mockResolvedValue(undefined),
		cont: spyOn(FluxifyHarness.prototype, "continue").mockResolvedValue(undefined),
	};
}

afterEach(() => mock.restore());

describe("harness worker job handling", () => {
	it("claims a start job out of `queued` before doing any AI work", async () => {
		const claim = spyOn(HarnessService.prototype, "claimRun").mockResolvedValue(true);
		const harness = stubHarness();

		await __runJob(job({ type: "start" }));

		expect(claim).toHaveBeenCalledWith("run1", "queued", "routing");
		expect(harness.start).toHaveBeenCalledTimes(1);
		expect(harness.cont).not.toHaveBeenCalled();
	});

	it("claims a continue job out of `awaiting_hitl`", async () => {
		const claim = spyOn(HarnessService.prototype, "claimRun").mockResolvedValue(true);
		const harness = stubHarness();

		await __runJob(job({ type: "continue", action: { type: "approve" } }));

		expect(claim).toHaveBeenCalledWith("run1", "awaiting_hitl", "executing");
		expect(harness.cont).toHaveBeenCalledTimes(1);
		expect(harness.start).not.toHaveBeenCalled();
	});

	it("drops a duplicate delivery without running the graph", async () => {
		spyOn(HarnessService.prototype, "claimRun").mockResolvedValue(false);
		const harness = stubHarness();

		await __runJob(job({}));

		expect(harness.start).not.toHaveBeenCalled();
		expect(harness.cont).not.toHaveBeenCalled();
	});

	it("rejects a job with no projectId before it can claim the run", async () => {
		const claim = spyOn(HarnessService.prototype, "claimRun").mockResolvedValue(true);

		expect(__runJob(job({ metadata: {} }))).rejects.toThrow("missing projectId");
		expect(claim).not.toHaveBeenCalled();
	});

	it("passes the job's own metadata through to the run context", async () => {
		spyOn(HarnessService.prototype, "claimRun").mockResolvedValue(true);
		const harness = stubHarness();
		const metadata = { projectId: "p1", userId: "u1", applyMode: "auto" as const };

		await __runJob(job({ query: "hi", metadata }));

		expect(harness.start.mock.calls[0][0]).toMatchObject({
			conversationId: "conv1",
			runId: "run1",
			query: "hi",
			metadata,
		});
	});
});

describe("releaseRun", () => {
	it("fails the run and the conversation so the claim can't strand them", async () => {
		const updateRun = spyOn(HarnessService.prototype, "updateRun").mockResolvedValue(
			undefined as any,
		);
		const updateConversation = spyOn(
			HarnessService.prototype,
			"updateConversationStatus",
		).mockResolvedValue(undefined as any);

		await __releaseRun({
			type: "start",
			conversationId: "conv1",
			runId: "run1",
		});

		expect(updateRun).toHaveBeenCalledWith({ runId: "run1", status: "failed" });
		expect(updateConversation).toHaveBeenCalledWith("failed");
	});

	it("swallows a database error — it is already the error path", async () => {
		spyOn(HarnessService.prototype, "updateRun").mockRejectedValue(
			new Error("db down"),
		);

		expect(
			__releaseRun({ type: "start", conversationId: "conv1", runId: "run1" }),
		).resolves.toBeUndefined();
	});
});
