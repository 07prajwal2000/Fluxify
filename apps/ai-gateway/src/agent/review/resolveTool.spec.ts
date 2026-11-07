import { describe, expect, it, mock } from "bun:test";
import { isRead, needsApproval, RESOLVE_FINDING } from "../tools";
import { resolveFindingTool } from "./resolveTool";

const call = (marked: number[], args: object) => {
	const resolve = mock(async () => marked);
	const t = resolveFindingTool("p1", "c1", resolve);
	return {
		resolve,
		out: t.execute?.(args as never, { toolCallId: "t", messages: [], context: {} } as never) as Promise<string>,
	};
};

describe("resolve_review_finding", () => {
	it("marks several findings in one call, by the numbers the user saw, as this chat's", async () => {
		const { resolve, out } = call([0, 2], {
			reviewId: "rev1",
			findings: [
				{ finding: 1, outcome: "fixed", note: "Added auth" },
				{ finding: 3, outcome: "not_an_issue" },
			],
		});
		expect(await out).toBe("Finding 1 marked fixed.\nFinding 3 marked not_an_issue.");
		const at = expect.any(String);
		expect(resolve).toHaveBeenCalledWith("rev1", "p1", [
			{ index: 0, resolution: { status: "fixed", note: "Added auth", conversationId: "c1", at } },
			{ index: 2, resolution: { status: "not_an_issue", conversationId: "c1", at } },
		]);
	});

	it("says which numbers did not exist", async () => {
		const { out } = call([0], {
			reviewId: "rev1",
			findings: [
				{ finding: 1, outcome: "fixed" },
				{ finding: 9, outcome: "fixed" },
			],
		});
		expect(await out).toBe("Finding 1 marked fixed.\nFinding 9: no such finding, not marked.");
	});

	it("tells the agent when the report was replaced", async () => {
		const { out } = call([], { reviewId: "old", findings: [{ finding: 1, outcome: "fixed" }] });
		expect(await out).toContain("Nothing was marked");
	});

	it("never asks for approval, in any mode", () => {
		expect(isRead(RESOLVE_FINDING)).toBe(true);
		expect(needsApproval("manual", RESOLVE_FINDING)).toBe(false);
	});
});
