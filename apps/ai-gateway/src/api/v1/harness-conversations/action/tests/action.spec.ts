import { describe, it, expect, mock, spyOn } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";
import * as cacheVersionModule from "../../cacheVersion";
import * as serverModule from "@fluxify/server";
import type { ConversationAction } from "../dto";

mock.module("../repository", () => ({
	setConversationFlags: mock(),
	markSubArtifactApplied: mock(),
}));

mock.module("../../cacheVersion", () => ({
	bumpListCacheVersion: mock(),
}));

/** Full conversation row the handler reads, with sensible defaults per test. */
function conv(overrides: Partial<Parameters<typeof handleRequest>[2]> = {}) {
	return {
		id: "conv1",
		userId: "user1",
		projectId: "proj1",
		archived: false,
		status: "idle",
		activeRunId: null,
		...overrides,
	};
}

const body = (action: ConversationAction, reviews?: string[]) => ({
	action,
	hitl_review: reviews ? { reviews } : undefined,
});

describe("Harness Conversation Action Service", () => {
	it("pins a non-archived conversation", async () => {
		const mockResponse = { id: "conv1", pinned: true, archived: false, updatedAt: new Date() };
		const setFlagsSpy = spyOn(repository, "setConversationFlags").mockResolvedValue(
			mockResponse as never,
		);
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as never);

		const result = await handleRequest("conv1", body("pin"), conv());

		expect(setFlagsSpy).toHaveBeenCalledWith("conv1", { pinned: true });
		expect(result).toEqual(mockResponse);
	});

	it("rejects pinning an archived conversation", async () => {
		expect(
			handleRequest("conv1", body("pin"), conv({ archived: true })),
		).rejects.toThrow(serverModule.ConflictError);
	});

	it("unpins a conversation", async () => {
		const setFlagsSpy = spyOn(repository, "setConversationFlags").mockResolvedValue({} as never);
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as never);

		await handleRequest("conv1", body("unpin"), conv());

		expect(setFlagsSpy).toHaveBeenCalledWith("conv1", { pinned: false });
	});

	it("archiving also clears pinned", async () => {
		const setFlagsSpy = spyOn(repository, "setConversationFlags").mockResolvedValue({} as never);
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as never);

		await handleRequest("conv1", body("archive"), conv());

		expect(setFlagsSpy).toHaveBeenCalledWith("conv1", { archived: true, pinned: false });
	});

	it("unarchiving does not touch pinned", async () => {
		const setFlagsSpy = spyOn(repository, "setConversationFlags").mockResolvedValue({} as never);
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as never);

		await handleRequest("conv1", body("unarchive"), conv({ archived: true }));

		expect(setFlagsSpy).toHaveBeenCalledWith("conv1", { archived: false });
	});

	it("busts the requesting user's list cache", async () => {
		spyOn(repository, "setConversationFlags").mockResolvedValue({} as never);
		const bumpSpy = spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(
			undefined as never,
		);

		await handleRequest("conv1", body("pin"), conv());

		expect(bumpSpy).toHaveBeenCalledWith("user1");
	});

	it("rejects interrupt when the conversation is not running", async () => {
		expect(
			handleRequest("conv1", body("user_interrupt"), conv({ status: "idle" })),
		).rejects.toThrow(serverModule.ConflictError);
	});

	it("rejects a HITL action when not awaiting review", async () => {
		expect(
			handleRequest("conv1", body("hitl_approve"), conv({ status: "running" })),
		).rejects.toThrow(serverModule.ConflictError);
	});

	it("marks a sub-artifact applied whatever the run status, as often as asked", async () => {
		const markSpy = spyOn(repository, "markSubArtifactApplied").mockResolvedValue({
			id: "sub1",
			appliedAt: new Date(),
		} as never);
		const applyBody = {
			action: "sub_artifact_applied" as const,
			sub_artifact: { subArtifactId: "sub1" },
		};

		await handleRequest("conv1", applyBody, conv({ status: "running" }));
		await handleRequest("conv1", applyBody, conv({ status: "running" }));

		expect(markSpy).toHaveBeenCalledTimes(2);
		expect(markSpy).toHaveBeenCalledWith("conv1", "sub1");
	});

	it("404s when the sub-artifact is not in this conversation", async () => {
		spyOn(repository, "markSubArtifactApplied").mockResolvedValue(undefined as never);

		expect(
			handleRequest(
				"conv1",
				{ action: "sub_artifact_applied", sub_artifact: { subArtifactId: "other" } },
				conv(),
			),
		).rejects.toThrow(serverModule.NotFoundError);
	});
});
