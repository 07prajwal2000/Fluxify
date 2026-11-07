import { describe, expect, it, mock } from "bun:test";
import { isRead, needsApproval, RESOLVE_FINDING } from "../tools";
import { resolveFindingTool } from "./resolveTool";

const call = (ok: boolean, args: object) => {
	const resolve = mock(async () => ok);
	const t = resolveFindingTool("p1", "c1", resolve);
	return {
		resolve,
		out: t.execute?.(args as never, { toolCallId: "t", messages: [], context: {} } as never) as Promise<string>,
	};
};

describe("resolve_review_finding", () => {
	it("marks the finding as this chat's, in the run's project", async () => {
		const { resolve, out } = call(true, {
			reviewId: "rev1",
			finding: 2,
			outcome: "fixed",
			note: "Added two suites",
		});
		expect(await out).toBe("Finding 2 marked fixed.");
		expect(resolve).toHaveBeenCalledWith("rev1", "p1", 2, {
			status: "fixed",
			note: "Added two suites",
			conversationId: "c1",
			at: expect.any(String),
		});
	});

	it("tells the agent when the report was replaced", async () => {
		const { out } = call(false, { reviewId: "old", finding: 0, outcome: "not_an_issue" });
		expect(await out).toContain("nothing was marked");
	});

	it("never asks for approval, in any mode", () => {
		expect(isRead(RESOLVE_FINDING)).toBe(true);
		expect(needsApproval("manual", RESOLVE_FINDING)).toBe(false);
	});
});
