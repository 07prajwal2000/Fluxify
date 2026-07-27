import { describe, it, expect, mock, spyOn } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";
import { encodeCursor, decodeCursor } from "../cursor";

mock.module("../repository", () => ({
	getMessagesPage: mock(),
}));

function makeRows(count: number) {
	// Newest first, as the repository returns them.
	return Array.from({ length: count }, (_, i) => ({
		id: `run${count - i}`,
		userQuery: `q${count - i}`,
		aiResponse: null,
		status: "completed",
		createdAt: new Date(2026, 0, 1, 0, count - i),
		completedAt: null,
		artifactId: null,
	}));
}

describe("List Harness Conversation Messages Service", () => {
	it("returns oldest-first and reports no more pages when the page isn't full", async () => {
		spyOn(repository, "getMessagesPage").mockResolvedValue(
			makeRows(3) as never,
		);

		const result = await handleRequest("conv1");

		expect(result.messages.map((m) => m.id)).toEqual(["run3", "run2", "run1"]);
		expect(result.pagination).toEqual({ nextCursor: null, hasMore: false });
	});

	it("trims the probe row and points nextCursor at the oldest returned message", async () => {
		spyOn(repository, "getMessagesPage").mockResolvedValue(
			makeRows(21) as never,
		);

		const result = await handleRequest("conv1");

		expect(result.messages).toHaveLength(20);
		// Oldest of the 21 rows is the probe and must not leak into the page.
		expect(result.messages[0].id).toBe("run21");
		expect(result.pagination.hasMore).toBe(true);
		expect(decodeCursor(result.pagination.nextCursor!).id).toBe("run2");
	});

	it("passes the decoded cursor through to the query", async () => {
		const spy = spyOn(repository, "getMessagesPage").mockResolvedValue(
			[] as never,
		);
		const createdAt = new Date(2026, 0, 1);
		const cursor = encodeCursor({ createdAt, id: "run2" });

		await handleRequest("conv1", cursor);

		expect(spy).toHaveBeenCalledWith("conv1", 21, { createdAt, id: "run2" });
	});

	it("rejects a malformed cursor", async () => {
		spyOn(repository, "getMessagesPage").mockResolvedValue([] as never);
		expect(handleRequest("conv1", "not-a-cursor")).rejects.toThrow();
	});
});
