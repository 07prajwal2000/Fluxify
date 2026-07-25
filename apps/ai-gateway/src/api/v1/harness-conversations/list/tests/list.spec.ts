import { describe, it, expect, mock, spyOn } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";
import * as statusModule from "../../status";
import * as cacheVersionModule from "../../cacheVersion";
import * as serverModule from "@fluxify/server";

mock.module("../repository", () => ({
	getConversationsByUserId: mock(),
	countConversationsByUserId: mock(),
	getLatestUserQueries: mock(),
	getStatusesByIds: mock(),
}));

mock.module("../../status", () => ({
	resolveRealtimeStatuses: mock(),
}));

mock.module("../../cacheVersion", () => ({
	getListCacheVersion: mock(),
}));

mock.module("@fluxify/server", () => ({
	getCache: mock(),
	setCacheEx: mock(),
}));

describe("List Harness Conversations Service", () => {
	it("on a cache miss, builds the page fresh and never re-queries statuses", async () => {
		const conversation = {
			id: "conv1",
			title: "Chat",
			status: "running",
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		spyOn(cacheVersionModule, "getListCacheVersion").mockResolvedValue("0");
		spyOn(serverModule, "getCache").mockResolvedValue("");
		spyOn(repository, "getConversationsByUserId").mockResolvedValue([conversation] as never);
		spyOn(repository, "countConversationsByUserId").mockResolvedValue(1 as never);
		const getLatestUserQueriesSpy = spyOn(repository, "getLatestUserQueries");
		const getStatusesByIdsSpy = spyOn(repository, "getStatusesByIds");
		spyOn(statusModule, "resolveRealtimeStatuses").mockResolvedValue(
			new Map([["conv1", "executing"]]) as never,
		);

		const result = await handleRequest("user1", 1, 10, false);

		expect(getLatestUserQueriesSpy).not.toHaveBeenCalled();
		expect(getStatusesByIdsSpy).not.toHaveBeenCalled();
		expect(result.data[0].status).toBe("executing");
		expect(result.data[0].userQuery).toBeUndefined();
		expect(result.pagination).toEqual({ page: 1, totalPages: 1, hasNext: false });
	});

	it("attaches a truncated userQuery when needUserQuery=true", async () => {
		const conversation = {
			id: "conv1",
			title: "Chat",
			status: "idle",
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		spyOn(cacheVersionModule, "getListCacheVersion").mockResolvedValue("0");
		spyOn(serverModule, "getCache").mockResolvedValue("");
		spyOn(repository, "getConversationsByUserId").mockResolvedValue([conversation] as never);
		spyOn(repository, "countConversationsByUserId").mockResolvedValue(1 as never);
		spyOn(repository, "getLatestUserQueries").mockResolvedValue(
			new Map([["conv1", "This is a very long user query that exceeds thirty chars"]]) as never,
		);
		spyOn(statusModule, "resolveRealtimeStatuses").mockResolvedValue(
			new Map([["conv1", "idle"]]) as never,
		);

		const result = await handleRequest("user1", 1, 10, true);

		expect(result.data[0].userQuery?.endsWith("...")).toBe(true);
		expect(result.data[0].userQuery?.length).toBe(33);
	});

	it("on a cache hit, refreshes statuses from the DB instead of trusting the cached ones", async () => {
		const cachedPage = {
			data: [
				{
					id: "conv1",
					title: "Chat",
					status: "running", // stale — cached when the run was still active
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
			],
			pagination: { page: 1, totalPages: 1, hasNext: false },
		};
		spyOn(cacheVersionModule, "getListCacheVersion").mockResolvedValue("0");
		spyOn(serverModule, "getCache").mockResolvedValue(JSON.stringify(cachedPage));
		// Run actually finished since the cache entry was written.
		const getStatusesByIdsSpy = spyOn(repository, "getStatusesByIds").mockResolvedValue(
			new Map([["conv1", "completed"]]) as never,
		);
		const resolveSpy = spyOn(statusModule, "resolveRealtimeStatuses").mockResolvedValue(
			new Map([["conv1", "completed"]]) as never,
		);

		const result = await handleRequest("user1", 1, 10, false);

		expect(getStatusesByIdsSpy).toHaveBeenCalledWith(["conv1"]);
		expect(resolveSpy).toHaveBeenCalledWith([{ id: "conv1", status: "completed" }]);
		expect(result.data[0].status).toBe("completed");
	});

	it("scopes the cache key to the current cache version so a bump busts old entries", async () => {
		spyOn(cacheVersionModule, "getListCacheVersion").mockResolvedValue("3");
		const getCacheSpy = spyOn(serverModule, "getCache").mockResolvedValue("");
		spyOn(repository, "getConversationsByUserId").mockResolvedValue([] as never);
		spyOn(repository, "countConversationsByUserId").mockResolvedValue(0 as never);
		spyOn(statusModule, "resolveRealtimeStatuses").mockResolvedValue(new Map() as never);

		await handleRequest("user1", 1, 10, false);

		expect(getCacheSpy).toHaveBeenCalledWith("harness-conversations:list:user1:3:1:10:false");
	});
});
