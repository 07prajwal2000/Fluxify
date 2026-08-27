import { describe, expect, it } from "bun:test";
import { createFindResourceTool } from "./findResource";
import {
	encodeResourceCursor,
	type DbService,
} from "../internal/dbService";
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

	it("lists a resource type for * or all and carries its cursor forward", async () => {
		const calls: any[][] = [];
		const tool = createFindResourceTool(
			{
				listCustomBlocks: async (...args: any[]) => {
					calls.push(args);
					return {
						items: [
							{
								type: "custom_block",
								id: "block-1",
								name: "user_defined.project.audit",
								label: "Audit",
							},
						],
						nextCursor: encodeResourceCursor("custom_block", "block-1"),
					};
				},
			} as unknown as DbService,
			metadata,
		);

		const first = await tool.invoke({
			searchQuery: "*",
			resourceType: "custom_block",
		});
		const cursor = encodeResourceCursor("custom_block", "block-1");
		const second = await tool.invoke({
			searchQuery: "ALL",
			resourceType: "custom_block",
			cursor,
		});

		expect(first).toContain("Audit");
		expect(first).toContain(cursor);
		expect(second).toContain("More results exist");
		expect(calls).toEqual([
			["proj-1", undefined],
			["proj-1", "block-1"],
		]);
	});

	// A prompt line saying "you already have the canvas" is advice the model
	// ignored; an absent enum value is not. Searching still works — that is a
	// need this agent keeps.
	describe("withoutCanvasLookup", () => {
		const restricted = () =>
			createFindResourceTool({} as DbService, metadata, {
				withoutCanvasLookup: true,
			});

		it("drops the canvas resource types", () => {
			const types = (restricted().schema as any).shape.resourceType.options;
			expect(types).toEqual([
				"route",
				"app_config",
				"integration",
				"custom_block",
			]);
			expect(restricted().description).toContain("already in your context");
		});

		it("still offers every non-canvas lookup", () => {
			const types = (
				createFindResourceTool({} as DbService, metadata).schema as any
			).shape.resourceType.options;
			expect(types).toContain("route_canvas");
			expect(types).toContain("custom_block_canvas");
		});
	});

	it("rejects a cursor for a different resource type", async () => {
		const tool = createFindResourceTool({} as DbService, metadata);
		const out = await tool.invoke({
			searchQuery: "all",
			resourceType: "custom_block",
			cursor: encodeResourceCursor("route", "route-1"),
		});

		expect(out).toContain("Invalid cursor for this resource type.");
	});
});
