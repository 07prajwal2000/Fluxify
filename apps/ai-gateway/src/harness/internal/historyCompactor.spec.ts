import { describe, expect, it } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import type { AgentFactory } from "../models/factory";
import type { RunBudget } from "../models/budget";
import type { HarnessService } from "./harnessService";
import { compactCompletedHistory } from "./historyCompactor";
import type { HistoryRun } from "./historyCompaction";

const sourceRuns: HistoryRun[] = Array.from({ length: 5 }, (_, index) => ({
	id: `run-${index + 1}`,
	userQuery: `user ${index + 1}`,
	aiResponse: `assistant ${index + 1}`,
	usage: { inputTokens: 10, outputTokens: 2 },
	createdAt: new Date(index * 1_000),
}));

function harness(save: (input: any) => void): HarnessService {
	return {
		getConversationId: () => "conversation-1",
		getEligibleHistoryCompactionBlock: async () => sourceRuns,
		saveHistoryCompaction: async (input: any) => save(input),
	} as unknown as HarnessService;
}

describe("compactCompletedHistory", () => {
	it("stores source and compaction I/O totals separately", async () => {
		let budget: RunBudget | undefined;
		const response = new AIMessage({
			content: "Kept all decisions and pending work.",
			usage_metadata: {
				input_tokens: 500,
				output_tokens: 70,
				total_tokens: 570,
			},
		});
		const factory = {
			createAgent: () => ({
				setRunBudget: (value: RunBudget) => {
					budget = value;
				},
				invokeAgent: async () => {
					budget!.record("historyCompaction", response, 5);
					return response;
				},
			}),
		} as unknown as AgentFactory;
		let saved: any;

		await compactCompletedHistory(factory, harness((input) => (saved = input)));

		expect(saved.sourceRuns).toEqual(sourceRuns);
		expect(saved.compactionUsage).toEqual({
			inputTokens: 500,
			outputTokens: 70,
		});
	});

	it("fails open when the model call fails", async () => {
		const factory = {
			createAgent: () => ({
				setRunBudget: () => {},
				invokeAgent: async () => {
					throw new Error("provider unavailable");
				},
			}),
		} as unknown as AgentFactory;
		let saved = false;

		await expect(
			compactCompletedHistory(factory, harness(() => (saved = true))),
		).resolves.toBeUndefined();
		expect(saved).toBe(false);
	});
});
