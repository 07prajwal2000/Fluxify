import { describe, expect, it } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { RunBudget, RunBudgetExceededError } from "./budget";

/** An AIMessage carrying the usage shape every provider normalizes to. */
function reply(input: number, output: number, cacheRead = 0) {
	return new AIMessage({
		content: "ok",
		usage_metadata: {
			input_tokens: input,
			output_tokens: output,
			total_tokens: input + output,
			input_token_details: { cache_read: cacheRead },
		},
	});
}

describe("RunBudget", () => {
	it("allows calls while there is time and tokens left", () => {
		const budget = new RunBudget({ deadlineMs: 60_000, tokenBudget: 1000 });
		budget.record("planner", reply(100, 10), 5);
		expect(() => budget.check()).not.toThrow();
	});

	it("stops the run once the token ceiling is reached", () => {
		const budget = new RunBudget({ deadlineMs: 60_000, tokenBudget: 500 });
		budget.record("planner", reply(400, 50), 5);
		expect(() => budget.check()).not.toThrow();
		budget.record("planner", reply(40, 20), 5);
		expect(() => budget.check()).toThrow(RunBudgetExceededError);
	});

	it("stops the run once the deadline has passed", async () => {
		const budget = new RunBudget({ deadlineMs: 1, tokenBudget: 0 });
		await Bun.sleep(5);
		expect(budget.remainingMs()).toBeLessThan(0);
		expect(() => budget.check()).toThrow(/time limit/);
	});

	it("says 'run budget exceeded' so the failure report can explain itself", () => {
		// `explainErrorReason` keys off this exact phrase — the message names both
		// tokens and a limit, so without it the run would be blamed on the provider.
		const budget = new RunBudget({ deadlineMs: 60_000, tokenBudget: 1 });
		budget.record("planner", reply(5, 5), 1);
		expect(() => budget.check()).toThrow(/run budget exceeded/i);
	});

	it("treats a zero budget as unlimited", () => {
		const budget = new RunBudget({ deadlineMs: 0, tokenBudget: 0 });
		budget.record("planner", reply(10_000_000, 1), 1);
		expect(() => budget.check()).not.toThrow();
	});

	it("accounts per agent as well as per run, cache reads included", () => {
		const budget = new RunBudget({ deadlineMs: 60_000, tokenBudget: 0 });
		budget.record("planner", reply(100, 10, 80), 20);
		budget.record("blockBuilder", reply(200, 20, 150), 30);
		budget.record("blockBuilder", reply(50, 5), 10);

		const usage = budget.snapshot();
		expect(usage.calls).toBe(3);
		expect(usage.totalTokens).toBe(385);
		expect(usage.cachedInputTokens).toBe(230);
		expect(usage.modelMs).toBe(60);
		expect(usage.byAgent.blockBuilder).toEqual({
			calls: 2,
			retries: 0,
			inputTokens: 250,
			historyInputTokens: 0,
			outputTokens: 25,
			cachedInputTokens: 150,
			modelMs: 40,
		});
	});

	it("tracks estimated conversation-history tokens separately", () => {
		const budget = new RunBudget({ deadlineMs: 60_000, tokenBudget: 0 });
		budget.record("planner", reply(100, 10), 20, 40);

		const usage = budget.snapshot();
		expect(usage.inputTokens).toBe(100);
		expect(usage.historyInputTokens).toBe(40);
	});

	it("counts re-asks separately from calls", () => {
		// Retries are already counted as calls; without this the run looks like it
		// did four different things instead of the same one four times.
		const budget = new RunBudget({ deadlineMs: 60_000, tokenBudget: 0 });
		budget.record("planner", reply(10, 1), 1);
		budget.recordRetry("planner");
		budget.record("planner", reply(10, 1), 1);

		const usage = budget.snapshot();
		expect(usage.calls).toBe(2);
		expect(usage.retries).toBe(1);
		expect(usage.byAgent.planner!.retries).toBe(1);
	});

	it("still counts a call from a provider that reports no usage", () => {
		// Compatible servers often omit usage_metadata. The call must still be
		// visible, otherwise the run looks free.
		const budget = new RunBudget({ deadlineMs: 60_000, tokenBudget: 0 });
		budget.record(undefined, new AIMessage("ok"), 12);

		const usage = budget.snapshot();
		expect(usage.calls).toBe(1);
		expect(usage.totalTokens).toBe(0);
		expect(usage.byAgent.unknown!.calls).toBe(1);
	});
});
