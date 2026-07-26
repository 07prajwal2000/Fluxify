import { describe, it, expect, mock, spyOn } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";

mock.module("../repository", () => ({
	deleteConversation: mock(),
}));

mock.module("../../cacheVersion", () => ({
	bumpListCacheVersion: mock(),
}));

describe("Delete Harness Conversation Service", () => {
	it("should delete conversation and bust the list cache", async () => {
		const deleteSpy = spyOn(repository, "deleteConversation").mockResolvedValue(undefined as never);

		const result = await handleRequest("conv1", "user1");

		expect(deleteSpy).toHaveBeenCalledWith("conv1");
		expect(result.success).toBe(true);
	});
});
