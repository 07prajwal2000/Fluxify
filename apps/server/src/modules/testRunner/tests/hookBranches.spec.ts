import { describe, expect, it } from "bun:test";
import { skipBranchLiterals } from "../hookBranches";

describe("skipBranchLiterals", () => {
	it("finds the branch name written as text", () => {
		expect(skipBranchLiterals(`t.skip({ ok: false }, "failure")`)).toEqual(["failure"]);
		expect(skipBranchLiterals(`t.skip(out, 'success');\nt.skip(out, "failure");`)).toEqual([
			"success",
			"failure",
		]);
	});

	it("reads past commas and brackets inside the output", () => {
		expect(skipBranchLiterals(`t.skip({ a: [1, 2], b: f("x", "y") }, "failure")`)).toEqual([
			"failure",
		]);
	});

	it("ignores a skip with no branch, or a branch that is not plain text", () => {
		expect(skipBranchLiterals(`t.skip({ a: 1 })`)).toEqual([]);
		expect(skipBranchLiterals(`t.skip(out, which)`)).toEqual([]);
		expect(skipBranchLiterals(`t.skip(out, ok ? "success" : "failure")`)).toEqual([]);
		expect(skipBranchLiterals(`t.skip(f("a", "b"))`)).toEqual([]);
	});
});
