import { expect, it } from "bun:test";
import { runBlock } from "@fluxify/sdk/testing";
import agent from "./agent";
import tool from "./tool";

/**
 * A Tool block run by hand: its output is what the agent's `tools` handle gets
 * from one branch. `execute` stands in for the chain wired under the tool.
 */
async function toolBranch(name: string, execute: (args: unknown) => unknown) {
	const r = await runBlock(tool, {
		params: { name },
		handles: { execute },
		keepAlive: true,
	});
	return { label: name, run: () => r.output };
}

it("calls the tools the prompt names and returns what they gave back", async () => {
	const r = await runBlock(agent, {
		params: { prompt: "search the docs, then email Ada" },
		handles: {
			tools: [
				await toolBranch("search", () => "3 hits"),
				await toolBranch("email", () => "sent"),
				await toolBranch("sms", () => "never asked for"),
			],
		},
	});
	expect(r.error).toBeUndefined();
	expect(r.handle).toBe("success");
	expect(r.output).toEqual({
		answer: "used search, email",
		calls: [
			{ tool: "search", args: { text: "search the docs, then email Ada" }, result: "3 hits" },
			{ tool: "email", args: { text: "search the docs, then email Ada" }, result: "sent" },
		],
	});
	// one span per tool call, under the agent's own
	expect(r.spans.map((s) => s.name)).toEqual(["tool:search", "tool:email"]);
});

it("answers without a tool when the prompt names none", async () => {
	const r = await runBlock(agent, {
		params: { prompt: "hello" },
		handles: { tools: [await toolBranch("search", () => 1)] },
	});
	expect(r.output).toEqual({ answer: "no tool needed", calls: [] });
});

it("keeps going when a tool's chain throws, and says so in its entry", async () => {
	const r = await runBlock(agent, {
		params: { prompt: "search and email" },
		handles: {
			tools: [
				await toolBranch("search", () => {
					throw new Error("index is down");
				}),
				await toolBranch("email", () => "sent"),
			],
		},
	});
	expect(r.handle).toBe("success");
	expect((r.output as { calls: unknown[] }).calls).toMatchObject([
		{ tool: "search", error: "index is down" },
		{ tool: "email", result: "sent" },
	]);
	expect(r.spans.map((s) => s.outcome)).toEqual(["failure", "success"]);
});

it("skips a Tool block that failed, and logs it", async () => {
	const r = await runBlock(agent, {
		params: { prompt: "search" },
		handles: {
			tools: [
				{
					label: "broken",
					run: () => {
						throw new Error("bad name");
					},
				},
				await toolBranch("search", () => "ok"),
			],
		},
	});
	expect(r.handle).toBe("success");
	expect((r.output as { answer: string }).answer).toBe("used search");
	expect(r.logs).toMatchObject([{ level: "warn" }]);
});

it("stops at max tool calls", async () => {
	const r = await runBlock(agent, {
		params: { prompt: "search email", maxCalls: 1 },
		handles: {
			tools: [await toolBranch("search", () => 1), await toolBranch("email", () => 2)],
		},
	});
	expect((r.output as { calls: unknown[] }).calls).toHaveLength(1);
});

it("needs a prompt", async () => {
	const r = await runBlock(agent, { params: {} as never });
	expect(r.error?.message).toBe("param 'prompt' is required");
	// a failed run leaves by `failure`, with the message
	expect(r.handle).toBe("failure");
});
