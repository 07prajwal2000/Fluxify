import { describe, it, expect, spyOn, mock, afterEach } from "bun:test";
import handleRequest from "../service";
import * as repository from "../../repository";
import * as enqueueModule from "../../../../../harness/internal/enqueue";
import * as cacheVersionModule from "../../cacheVersion";
import * as serverModule from "@fluxify/server";

describe("Send Message Service", () => {
	afterEach(() => {
		mock.restore();
	});

	it("throws NotFoundError when conversationId is given but does not exist", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue(undefined as any);

		expect(
			handleRequest("user1", { conversationId: "conv1", query: "hi" }, false),
		).rejects.toThrow(serverModule.NotFoundError);
	});

	it("throws ForbiddenError when the conversation belongs to another user", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "someone-else",
			status: "idle",
		} as any);

		expect(
			handleRequest("user1", { conversationId: "conv1", query: "hi" }, false),
		).rejects.toThrow(serverModule.ForbiddenError);
	});

	it("throws ConflictError when the conversation already has a run in progress", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "user1",
			status: "running",
		} as any);

		expect(
			handleRequest("user1", { conversationId: "conv1", query: "hi" }, false),
		).rejects.toThrow(serverModule.ConflictError);
	});

	it("creates a fresh conversation and enqueues a start job when conversationId is omitted", async () => {
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as any);
		const enqueueSpy = spyOn(enqueueModule, "enqueueHarnessStart").mockResolvedValue({
			conversationId: "conv-new",
			runId: "run-new",
		} as any);

		const result = await handleRequest(
			"user1",
			{ query: "hello", location: { where: "route-canvas", id: "r_1" } },
			false,
		);

		expect(enqueueSpy).toHaveBeenCalledWith({
			conversationId: undefined,
			query: "hello",
			metadata: { userId: "user1", location: { where: "route-canvas", id: "r_1" } },
		});
		expect(result).toEqual({ conversationId: "conv-new", runId: "run-new" });
	});

	it("allows sending to an owned, unlocked conversation", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "user1",
			status: "completed",
		} as any);
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as any);
		const enqueueSpy = spyOn(enqueueModule, "enqueueHarnessStart").mockResolvedValue({
			conversationId: "conv1",
			runId: "run-2",
		} as any);

		const result = await handleRequest("user1", { conversationId: "conv1", query: "hi again" }, false);

		expect(enqueueSpy).toHaveBeenCalled();
		expect(result).toEqual({ conversationId: "conv1", runId: "run-2" });
	});
});
