import { describe, expect, it } from "bun:test";
import { createGetArtifactTool } from "./getArtifact";
import type { DbService, SubArtifactRecord } from "../internal/dbService";
import type { WorkflowMetadata } from "../types";

const metadata = {
	conversationId: "conv-1",
	projectId: "proj-1",
} as WorkflowMetadata;

const record = (over: Partial<SubArtifactRecord> = {}): SubArtifactRecord => ({
	id: "sub-1",
	artifactId: "art-1",
	runId: "run-1",
	kind: "route",
	action: "add",
	appliedAt: null,
	payload: { data: { method: "GET", path: "/users" } },
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	...over,
});

const toolWith = (
	rows: SubArtifactRecord[],
	spy?: (args: any[]) => void,
	db: Partial<DbService> = {},
) =>
	createGetArtifactTool(
		{
			getSubArtifacts: async (...args: any[]) => {
				spy?.(args);
				return rows;
			},
			getRouteDetails: async () => null,
			getRouteCanvas: async () => null,
			getCustomBlockCanvas: async () => null,
			findCustomBlocks: async () => [],
			...db,
		} as unknown as DbService,
		metadata,
	);

describe("get_artifact", () => {
	it("scopes the lookup to the conversation and renders the payload", async () => {
		const calls: any[][] = [];
		const out = await toolWith([record()], (a) => calls.push(a)).invoke({
			artifactIds: ["sub-1"],
		});

		expect(calls[0]).toEqual(["conv-1", ["sub-1"]]);
		expect(out).toContain("kind=route, action=add");
		// Compact, not pretty-printed — indentation was ~15% of the payload and
		// this result is re-sent on every later tool iteration.
		expect(out).toContain('"path":"/users"');
	});

	it("tells the agent whether the output is already applied", async () => {
		const notApplied = await toolWith([record()]).invoke({ artifactIds: ["sub-1"] });
		expect(notApplied).toContain("applied=no");
		expect(notApplied).toContain("NOT APPLIED");

		const applied = await toolWith([
			record({ appliedAt: new Date("2026-02-02T00:00:00.000Z") }),
		]).invoke({ artifactIds: ["sub-1"] });
		expect(applied).toContain("applied=yes, at 2026-02-02T00:00:00.000Z");
	});

	// Without this the agent had to follow every applied artifact with a
	// `find_resource` call just to learn the real id it ended up with.
	it("returns the live record for an applied artifact, not the stored copy", async () => {
		const out = await toolWith(
			[
				record({
					appliedAt: new Date(),
					payload: { routeId: "live-route", data: { path: "/stale" } },
				}),
			],
			undefined,
			{
				getRouteDetails: async () => ({ id: "live-route", path: "/users" }),
				getRouteCanvas: async () => [{ id: "b1", blockType: "response" }],
			},
		).invoke({ artifactIds: ["sub-1"] });

		expect(out).toContain("APPLIED");
		expect(out).toContain('"path":"/users"');
		expect(out).toContain("response b1");
		expect(out).not.toContain("/stale");
	});

	it("says so when the applied resource has since been deleted", async () => {
		const out = await toolWith([
			record({ appliedAt: new Date(), payload: { routeId: "gone" } }),
		]).invoke({ artifactIds: ["sub-1"] });
		expect(out).toContain("gone from the project");
	});

	it("reports nothing found instead of returning empty output", async () => {
		const out = await toolWith([]).invoke({ artifactIds: ["nope"] });
		expect(out).toContain("No artifacts found");
	});

	it("truncates oversized payloads so the context window survives", async () => {
		const fat = record({ payload: { blocks: "x".repeat(20000) } });
		const out = await toolWith([fat]).invoke({ artifactIds: ["sub-1"] });
		expect(out).toContain("[truncated —");
		expect(out.length).toBeLessThan(13000);
	});
});
