import { describe, expect, it } from "bun:test";
import { createFindResourceTool } from "./findResource";
import type { DbService } from "../internal/dbService";
import type { WorkflowMetadata } from "../types";

const metadata = { projectId: "proj-1" } as WorkflowMetadata;

const toolWith = (rows: any[], calls: any[][]) =>
	createFindResourceTool(
		{
			findRoutes: async (...args: any[]) => {
				calls.push(args);
				return rows;
			},
		} as unknown as DbService,
		metadata,
	);

describe("find_resource", () => {
	it("forwards the caller's stated intent to the lookup", async () => {
		// The mode is declared, not sniffed from the string's shape: the agent
		// knows which it meant, and the trace should say so too.
		const calls: any[][] = [];
		await toolWith([], calls).invoke({
			searchQuery: "019f8c3d-1a2b-7c4d-8e5f-6a7b8c9d0e1f",
			resourceType: "route",
			searchBy: "id",
		});

		expect(calls[0]).toEqual([
			"proj-1",
			["019f8c3d-1a2b-7c4d-8e5f-6a7b8c9d0e1f"],
			"id",
		]);
	});

	it("defaults to keyword search, including when the model sends null", async () => {
		// The field is `.nullish()` per the schema rules, so null has to collapse
		// to the same default an omitted field gets.
		const calls: any[][] = [];
		const tool = toolWith([], calls);
		await tool.invoke({ searchQuery: "users", resourceType: "route" });
		await tool.invoke({
			searchQuery: "users",
			resourceType: "route",
			searchBy: null,
		});

		expect(calls.map((c) => c[2])).toEqual(["keyword", "keyword"]);
	});

	it("tells the agent an unknown id is not a cue to guess another one", async () => {
		const out = await toolWith([], []).invoke({
			searchQuery: "no-such-id",
			resourceType: "route",
			searchBy: "id",
		});

		expect(out).toContain("search by keyword");
	});
});
