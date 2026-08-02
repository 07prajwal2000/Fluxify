import { describe, it, expect, spyOn, mock, afterEach, beforeEach } from "bun:test";
import handleRequest from "../service";
import * as repository from "../../repository";
import * as enqueueModule from "../../../../../harness/internal/enqueue";
import * as cacheVersionModule from "../../cacheVersion";
import * as serverModule from "@fluxify/server";

describe("Send Message Service", () => {
	beforeEach(() => {
		// The run quota talks to Redis, which isn't up in unit tests. It fails open
		// either way; stubbing it keeps that out of these assertions (and out of
		// the log). Its own behavior is covered in rateLimit.spec.ts.
		spyOn(serverModule, "incrCache").mockResolvedValue(1);
		spyOn(serverModule, "expireCache").mockResolvedValue(1);
	});

	afterEach(() => {
		mock.restore();
	});

	it("throws NotFoundError when conversationId is given but does not exist", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue(undefined as any);

		expect(
			handleRequest("user1", "proj1", { conversationId: "conv1", query: "hi" }, false),
		).rejects.toThrow(serverModule.NotFoundError);
	});

	it("throws NotFoundError when the conversation belongs to a different project", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "user1",
			projectId: "proj-other",
			status: "idle",
		} as any);

		expect(
			handleRequest("user1", "proj1", { conversationId: "conv1", query: "hi" }, false),
		).rejects.toThrow(serverModule.NotFoundError);
	});

	it("throws ForbiddenError when the conversation belongs to another user", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "someone-else",
			projectId: "proj1",
			status: "idle",
		} as any);

		expect(
			handleRequest("user1", "proj1", { conversationId: "conv1", query: "hi" }, false),
		).rejects.toThrow(serverModule.ForbiddenError);
	});

	it("throws ConflictError when the conversation already has a run in progress", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "user1",
			projectId: "proj1",
			status: "running",
		} as any);

		expect(
			handleRequest("user1", "proj1", { conversationId: "conv1", query: "hi" }, false),
		).rejects.toThrow(serverModule.ConflictError);
	});

	it("throws ConflictError when the conversation is archived", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "user1",
			projectId: "proj1",
			status: "idle",
			archived: true,
		} as any);

		expect(
			handleRequest("user1", "proj1", { conversationId: "conv1", query: "hi" }, false),
		).rejects.toThrow(serverModule.ConflictError);
	});

	it("creates a fresh conversation and enqueues a start job with the projectId when conversationId is omitted", async () => {
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as any);
		const enqueueSpy = spyOn(enqueueModule, "enqueueHarnessStart").mockResolvedValue({
			conversationId: "conv-new",
			runId: "run-new",
		} as any);

		const result = await handleRequest(
			"user1",
			"proj1",
			{ query: "hello", location: { where: "route-canvas", id: "r_1" } },
			false,
		);

		expect(enqueueSpy).toHaveBeenCalledWith({
			conversationId: undefined,
			query: "hello",
			integrationId: undefined,
			metadata: {
				userId: "user1",
				projectId: "proj1",
				location: { where: "route-canvas", id: "r_1" },
				integrationId: undefined,
			},
		});
		expect(result).toEqual({ conversationId: "conv-new", runId: "run-new" });
	});

	function mockIntegrationRow(row: any) {
		return spyOn(repository, "getProjectIntegration").mockResolvedValue(
			row ?? (undefined as any),
		);
	}

	it("throws NotFoundError when the picked integration is missing or not AI", async () => {
		mockIntegrationRow(null);

		expect(
			handleRequest("user1", "proj1", { query: "hi", integrationId: "int1" }, false),
		).rejects.toThrow(serverModule.NotFoundError);
	});

	it("throws ForbiddenError when the picked integration is neither harness-enabled nor the project default", async () => {
		mockIntegrationRow({ group: "ai", config: { useForHarness: false } });
		spyOn(serverModule, "getProjectSetting").mockResolvedValue("int-other");

		expect(
			handleRequest("user1", "proj1", { query: "hi", integrationId: "int1" }, false),
		).rejects.toThrow(serverModule.ForbiddenError);
	});

	it("enqueues when the picked integration is the project's configured agent connection", async () => {
		mockIntegrationRow({ group: "ai", config: { useForHarness: false } });
		spyOn(serverModule, "getProjectSetting").mockResolvedValue("int1");
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as any);
		const enqueueSpy = spyOn(enqueueModule, "enqueueHarnessStart").mockResolvedValue({
			conversationId: "conv-new",
			runId: "run-new",
		} as any);

		await handleRequest("user1", "proj1", { query: "hi", integrationId: "int1" }, false);

		expect(enqueueSpy).toHaveBeenCalledWith(
			expect.objectContaining({ integrationId: "int1" }),
		);
	});

	it("enqueues with the picked integration when it is harness-enabled", async () => {
		mockIntegrationRow({ group: "ai", config: { useForHarness: true } });
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as any);
		const enqueueSpy = spyOn(enqueueModule, "enqueueHarnessStart").mockResolvedValue({
			conversationId: "conv-new",
			runId: "run-new",
		} as any);

		await handleRequest("user1", "proj1", { query: "hi", integrationId: "int1" }, false);

		expect(enqueueSpy).toHaveBeenCalledWith(
			expect.objectContaining({ integrationId: "int1" }),
		);
	});

	it("allows sending to an owned, unlocked conversation in the same project", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "user1",
			projectId: "proj1",
			status: "completed",
		} as any);
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as any);
		const enqueueSpy = spyOn(enqueueModule, "enqueueHarnessStart").mockResolvedValue({
			conversationId: "conv1",
			runId: "run-2",
		} as any);

		const result = await handleRequest(
			"user1",
			"proj1",
			{ conversationId: "conv1", query: "hi again" },
			false,
		);

		expect(enqueueSpy).toHaveBeenCalled();
		expect(result).toEqual({ conversationId: "conv1", runId: "run-2" });
	});
});
