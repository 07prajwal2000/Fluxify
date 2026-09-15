import { describe, expect, it } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import { block, createContext, edge } from "./compilerTestHelpers";

/** entry -> switch with a single case `hit` guarded by `condition` */
async function output(condition: string, input: unknown = "in") {
	const { run } = compileGraph(
		[
			block("entry", BlockTypes.entrypoint),
			block("sw", BlockTypes.switch, { conditions: { hit: condition } }),
			block("hit", BlockTypes.jsrunner, { value: 'return "hit";' }),
		],
		[edge("entry", "sw"), edge("sw", "hit", "case")],
	);
	return (await run(createContext(), input)).output;
}

describe("switch block: plain-text conditions", () => {
	for (const text of ["true", "TRUE", " True ", "yes", "0", "paid"]) {
		it(`"${text}" always matches`, async () => {
			expect(await output(text)).toBe("hit");
		});
	}

	for (const text of ["false", "FALSE", "  False  "]) {
		it(`"${text}" never matches`, async () => {
			expect(await output(text)).toBe("in");
		});
	}

	it("never runs plain text as JavaScript, even when it looks like code", async () => {
		expect(await output("return false;")).toBe("hit");
		expect(await output("throw new Error('ran as code')")).toBe("hit");
	});

	it("only treats a leading js: as code, not one in the middle", async () => {
		expect(await output("see js: return false;")).toBe("hit");
	});

	it("runs the same condition as code once it has the js: prefix", async () => {
		expect(await output("js: return false;")).toBe("in");
		expect(await output("js: return input === 'go';", "go")).toBe("hit");
	});

	it("a plain `true` case placed last acts as the default", async () => {
		const { run } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("sw", BlockTypes.switch, {
					order: ["paid", "other"],
					conditions: { other: "true", paid: "js: return input === 'paid';" },
				}),
				block("paid", BlockTypes.jsrunner, { value: 'return "paid";' }),
				block("other", BlockTypes.jsrunner, { value: 'return "other";' }),
			],
			[edge("entry", "sw"), edge("sw", "other", "case"), edge("sw", "paid", "case")],
		);
		expect((await run(createContext(), "paid")).output).toBe("paid");
		expect((await run(createContext(), "pending")).output).toBe("other");
	});
});
