import { describe, it, expect, mock, spyOn } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";

mock.module("../repository", () => ({
	updateConversationTitle: mock(),
}));

mock.module("../../cacheVersion", () => ({
	bumpListCacheVersion: mock(),
}));

describe("Update Harness Conversation Service", () => {
	it("should update conversation title and bust the list cache", async () => {
		const mockResponse = { id: "conv1", title: "New Title", updatedAt: new Date() };
		const updateSpy = spyOn(repository, "updateConversationTitle").mockResolvedValue(
			mockResponse as never,
		);

		const result = await handleRequest("conv1", "New Title", "user1");

		expect(updateSpy).toHaveBeenCalledWith("conv1", "New Title");
		expect(result).toEqual(mockResponse);
	});
});
