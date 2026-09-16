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
	it("runs the case when the input is strictly equal to the text", async () => {
		expect(await output("paid", "paid")).toBe("hit");
		expect(await output(" paid ", "paid")).toBe("hit");
		expect(await output("paid", "Paid")).toBe("Paid");
	});

	it("types numbers and booleans at compile time", async () => {
		expect(await output("404", 404)).toBe("hit");
		expect(await output("-1.5", -1.5)).toBe("hit");
		expect(await output("true", true)).toBe("hit");
		expect(await output("false", false)).toBe("hit");
	});

	it("uses strict equality, so the input's type matters", async () => {
		expect(await output("404", "404")).toBe("404");
		expect(await output("true", "true")).toBe("true");
		expect(await output("TRUE", true)).toBe(true);
		expect(await output("TRUE", "TRUE")).toBe("hit");
		expect(await output("0", false)).toBe(false);
	});

	it("never runs plain text as JavaScript, even when it looks like code", async () => {
		expect(await output("return true;")).toBe("in");
		expect(await output("throw new Error('ran as code')")).toBe("in");
		expect(await output("input.status", { status: "input.status" })).toEqual({ status: "input.status" });
	});

	it("only treats a leading js: as code, not one in the middle", async () => {
		expect(await output("see js: return true;")).toBe("in");
		expect(await output("see js: return true;", "see js: return true;")).toBe("hit");
	});

	it("runs js: conditions as code and tests them for truthiness", async () => {
		expect(await output("js: return true;")).toBe("hit");
		expect(await output("js: return input === 'go';", "go")).toBe("hit");
		expect(await output("js: return input === 'go';", "stop")).toBe("stop");
	});
});
