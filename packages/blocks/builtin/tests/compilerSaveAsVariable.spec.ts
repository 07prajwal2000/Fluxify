import { describe, it, expect } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import { block, createContext, edge } from "./compilerTestHelpers";

async function runWith(saveAsVariable?: unknown) {
	const { run, source } = compileGraph(
		[
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.transformer, {
				useJs: true,
				js: "return input.n * 2",
				fieldMap: {},
				saveAsVariable,
			}),
			block("3", BlockTypes.response, { httpCode: "200" }),
		],
		[edge("1", "2"), edge("2", "3")],
	);
	const ctx = createContext();
	const result = await run(ctx, { n: 21 });
	return { ctx, result, source };
}

describe("save output to variable", () => {
	it("stores the output in a var and still passes it on as input", async () => {
		const { ctx, result } = await runWith({ enabled: true, name: "doubled" });
		expect(ctx.vars.doubled).toBe(42);
		expect(result.output).toEqual({ httpCode: "200", body: 42 });
	});

	it("creates no var when the toggle is off", async () => {
		const { ctx, source } = await runWith({ enabled: false, name: "doubled" });
		expect(ctx.vars).not.toHaveProperty("doubled");
		expect(source).not.toContain('vars["doubled"]');
	});

	it("creates no var when the setting is missing", async () => {
		const { ctx } = await runWith();
		expect(Object.keys(ctx.vars)).toHaveLength(0);
	});

	it("trims the name before emitting it", async () => {
		const { ctx, source } = await runWith({ enabled: true, name: "  doubled  " });
		expect(source).toContain('vars["doubled"] = $in;');
		expect(ctx.vars.doubled).toBe(42);
	});

	it("ignores a name that is not an identifier", async () => {
		for (const name of ["1bad", "a-b", "x\"];evil();//", "   ", "class", "return"]) {
			const { ctx, source } = await runWith({ enabled: true, name });
			expect(Object.keys(ctx.vars)).toHaveLength(0);
			expect(source).not.toContain("evil");
		}
	});
});
