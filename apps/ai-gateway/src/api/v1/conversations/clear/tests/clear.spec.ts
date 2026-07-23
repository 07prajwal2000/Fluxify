import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";

mock.module("../repository", () => ({
	deleteMessages: mock(),
}));

import * as server from "@fluxify/server";
describe("Clear Conversation Service", () => {
	let deleteSpy: ReturnType<typeof spyOn>;
	let cacheDeleteSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		deleteSpy = spyOn(repository, "deleteMessages").mockResolvedValue(undefined as never);
		deleteSpy.mockClear();
		cacheDeleteSpy = spyOn(server, "deleteCacheKeysByPattern").mockResolvedValue(undefined as never);
		cacheDeleteSpy.mockClear();
	});

	it("should clear messages if confirm is true", async () => {
		const result = await handleRequest("conv1", true);
		expect(deleteSpy).toHaveBeenCalledWith("conv1");
		expect(result.success).toBe(true);
	});

	it("should not clear messages if confirm is false", async () => {
		const result = await handleRequest("conv1", false);
		expect(deleteSpy).not.toHaveBeenCalled();
		expect(result.success).toBe(false);
	});
});
