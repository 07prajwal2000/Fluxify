import { describe, it, expect, mock, spyOn } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";
import * as cacheVersionModule from "../../cacheVersion";
import * as serverModule from "@fluxify/server";

mock.module("../repository", () => ({
	setConversationFlags: mock(),
}));

mock.module("../../cacheVersion", () => ({
	bumpListCacheVersion: mock(),
}));

describe("Harness Conversation Action Service", () => {
	it("pins a non-archived conversation", async () => {
		const mockResponse = { id: "conv1", pinned: true, archived: false, updatedAt: new Date() };
		const setFlagsSpy = spyOn(repository, "setConversationFlags").mockResolvedValue(
			mockResponse as never,
		);
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as never);

		const result = await handleRequest("conv1", "pin", { userId: "user1", archived: false });

		expect(setFlagsSpy).toHaveBeenCalledWith("conv1", { pinned: true });
		expect(result).toEqual(mockResponse);
	});

	it("rejects pinning an archived conversation", async () => {
		expect(
			handleRequest("conv1", "pin", { userId: "user1", archived: true }),
		).rejects.toThrow(serverModule.ConflictError);
	});

	it("unpins a conversation", async () => {
		const setFlagsSpy = spyOn(repository, "setConversationFlags").mockResolvedValue({} as never);
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as never);

		await handleRequest("conv1", "unpin", { userId: "user1", archived: false });

		expect(setFlagsSpy).toHaveBeenCalledWith("conv1", { pinned: false });
	});

	it("archiving also clears pinned", async () => {
		const setFlagsSpy = spyOn(repository, "setConversationFlags").mockResolvedValue({} as never);
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as never);

		await handleRequest("conv1", "archive", { userId: "user1", archived: false });

		expect(setFlagsSpy).toHaveBeenCalledWith("conv1", { archived: true, pinned: false });
	});

	it("unarchiving does not touch pinned", async () => {
		const setFlagsSpy = spyOn(repository, "setConversationFlags").mockResolvedValue({} as never);
		spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(undefined as never);

		await handleRequest("conv1", "unarchive", { userId: "user1", archived: true });

		expect(setFlagsSpy).toHaveBeenCalledWith("conv1", { archived: false });
	});

	it("busts the requesting user's list cache", async () => {
		spyOn(repository, "setConversationFlags").mockResolvedValue({} as never);
		const bumpSpy = spyOn(cacheVersionModule, "bumpListCacheVersion").mockResolvedValue(
			undefined as never,
		);

		await handleRequest("conv1", "pin", { userId: "user1", archived: false });

		expect(bumpSpy).toHaveBeenCalledWith("user1");
	});
});
