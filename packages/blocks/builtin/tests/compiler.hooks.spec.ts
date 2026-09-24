import { describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import { compileGraph } from "../../compiler";
import { block, createContext, edge } from "./compilerTestHelpers";

// entry -> double -> reply
const linear = (hooks: boolean) =>
	compileGraph(
		[
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.jsrunner, { value: "return input * 2" }),
			block("3", BlockTypes.response, { httpCode: "200" }),
		],
		[edge("1", "2"), edge("2", "3")],
		{ hooks },
	);

/** a throw inside the graph comes back as `successful: false`, never a rejection */
const failureOf = async (compiled: ReturnType<typeof compileGraph>, testHooks: unknown, input: unknown) => {
	const ctx = createContext();
	ctx.testHooks = testHooks;
	const result = await compiled.run(ctx, input);
	expect(result.successful).toBe(false);
	return String((result as { error?: unknown }).error);
};

const runWith = async (compiled: ReturnType<typeof compileGraph>, testHooks: unknown, input: unknown) => {
	const ctx = createContext();
	ctx.testHooks = testHooks;
	return (await compiled.run(ctx, input)).output;
};

describe("compileGraph hooks (#483)", () => {
	it("leaves live compiles without any hook checks", () => {
		expect(linear(false).source).not.toContain("$hook");
		expect(linear(true).source).toContain("$hook");
	});

	it("runs as normal when a suite set no hooks", async () => {
		expect(await runWith(linear(true), undefined, 5)).toEqual({ httpCode: "200", body: 10 });
	});

	it("before replaces the input, after replaces the output", async () => {
		const seen: unknown[] = [];
		const out = await runWith(
			linear(true),
			{
				"2": {
					before: async () => ({ input: 100 }),
					after: async (input: unknown, output: unknown) => {
						seen.push(input, output);
						return (output as number) + 1;
					},
				},
			},
			5,
		);
		expect(seen).toEqual([100, 200]);
		expect(out).toEqual({ httpCode: "200", body: 201 });
	});

	it("skip does not run the block and passes the made-up output on, without after", async () => {
		const ctx = createContext();
		let after = 0;
		ctx.testHooks = {
			"2": {
				before: async () => ({ skip: true, output: "mocked" }),
				after: async () => after++,
			},
		};
		const result = await linear(true).run(ctx, 5);
		expect(result.output).toEqual({ httpCode: "200", body: "mocked" });
		expect(after).toBe(0);
	});

	it("skips a branching block down the chosen branch, with no database", async () => {
		const compiled = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.db_exists, { connection: "nope", tableName: "users", conditions: [] }),
				block("3", BlockTypes.response, { httpCode: "200" }),
				block("4", BlockTypes.response, { httpCode: "404" }),
			],
			[edge("1", "2"), edge("2", "3", "success"), edge("2", "4", "failure")],
			{ hooks: true },
		);
		const skip = (branch?: string) => ({
			"2": { before: async () => ({ skip: true, output: { id: 1 }, branch }) },
		});
		expect((await runWith(compiled, skip(), null)) as any).toMatchObject({ httpCode: "200" });
		expect((await runWith(compiled, skip("failure"), null)) as any).toMatchObject({ httpCode: "404" });
		expect(await failureOf(compiled, skip("nowhere"), null)).toContain('no branch "nowhere"');
	});

	it("lets an if block be steered by its input but not skipped", async () => {
		const compiled = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.if, {
					conditions: [{ lhs: "js:return input", rhs: 10, operator: "gt", chain: "and" }],
				}),
				block("3", BlockTypes.response, { httpCode: "200" }),
				block("4", BlockTypes.response, { httpCode: "400" }),
			],
			[edge("1", "2"), edge("2", "3", "success"), edge("2", "4", "failure")],
			{ hooks: true },
		);
		const steer = { "2": { before: async () => ({ input: 50 }) } };
		expect(((await runWith(compiled, steer, 1)) as any).httpCode).toBe("200");
		const skip = { "2": { before: async () => ({ skip: true, output: 1 }) } };
		expect(await failureOf(compiled, skip, 1)).toContain("cannot be skipped");
	});

	it("a throwing hook fails the block, so the error handler runs", async () => {
		const compiled = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.jsrunner, { value: "return input" }),
				block("3", BlockTypes.response, { httpCode: "200" }),
				block("h", BlockTypes.errorHandler),
				block("5", BlockTypes.response, { httpCode: "500" }),
			],
			[edge("1", "2"), edge("2", "3"), edge("h", "5")],
			{ hooks: true },
		);
		const hooks = { "2": { before: async () => { throw new Error("boom"); } } };
		expect(((await runWith(compiled, hooks, 1)) as any).httpCode).toBe("500");
	});
});
