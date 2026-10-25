import { describe, expect, it } from "bun:test";
import { assignedGlobals, blockAssignedGlobals } from "./scriptGlobals";

describe("assignedGlobals", () => {
	it("finds a name assigned without a declaration", () => {
		expect(assignedGlobals('myVar = ""')).toEqual(["myVar"]);
		expect(assignedGlobals("a = 1; b = a + 1;")).toEqual(["a", "b"]);
		expect(assignedGlobals("total = total + 1")).toEqual(["total"]);
	});

	it("counts a compound assignment or an increment", () => {
		expect(assignedGlobals("n += 1")).toEqual(["n"]);
		expect(assignedGlobals("n ||= 5")).toEqual(["n"]);
		expect(assignedGlobals("n ??= 5")).toEqual(["n"]);
		expect(assignedGlobals("count++")).toEqual(["count"]);
	});

	it("does not count a name the script declares, even where it is assigned", () => {
		expect(assignedGlobals("let x = 1; x = 2;")).toEqual([]);
		expect(assignedGlobals("x = 2; let x = 1;")).toEqual([]);
		expect(assignedGlobals("const y = 1; if (y) { y2 = 3 }")).toEqual(["y2"]);
		expect(assignedGlobals("var z; z = 1;")).toEqual([]);
	});

	it("reads every name of a declaration list and of a destructuring pattern", () => {
		expect(assignedGlobals("let a = 1, b = 2; a = 3; b = 4;")).toEqual([]);
		expect(assignedGlobals("let a = 1,\n  b = 2;\nb = 4;")).toEqual([]);
		expect(assignedGlobals("const { id, name: label } = input; id = 1; label = 2;")).toEqual([]);
		expect(assignedGlobals("let [first, second] = input; first = 1; second = 2;")).toEqual([]);
		expect(assignedGlobals("for (let i = 0, n = 3; i < n; i++) { i = i }")).toEqual([]);
		expect(assignedGlobals("for (const item of input) { total = item }")).toEqual(["total"]);
	});

	it("ends a declaration at a newline, so the next line can be a real global", () => {
		expect(assignedGlobals("let a = 1\nb = 2")).toEqual(["b"]);
	});

	it("does not count functions, classes, parameters or catch variables", () => {
		expect(assignedGlobals("function f(a, b = 1) { a = 2; b = 3 } f = 4")).toEqual([]);
		expect(assignedGlobals("const g = (p, q) => { p = 1; q = 2 }")).toEqual([]);
		expect(assignedGlobals("const h = r => { r = 1 }")).toEqual([]);
		expect(assignedGlobals("try { x() } catch (err) { err = 1 }")).toEqual([]);
		expect(assignedGlobals("class K {} K = 1")).toEqual([]);
	});

	it("does not count a comparison, an arrow, a member write, or text", () => {
		expect(assignedGlobals("if (a == b || c === d || e != f || g <= h) {}")).toEqual([]);
		expect(assignedGlobals("const fn = () => 1; list.map(x => x)")).toEqual([]);
		expect(assignedGlobals("obj.total = 1; arr[0] = 2; this.name = 3")).toEqual([]);
		expect(assignedGlobals('const s = "total = 1"; // total = 2\n/* total = 3 */')).toEqual([]);
		expect(assignedGlobals("const t = `total = ${1}`")).toEqual([]);
	});

	it("never counts the runtime's own names or JS built-ins", () => {
		expect(assignedGlobals("input = 1; outputs = 2; getHeader = 3; console = 4; Math = 5")).toEqual([]);
		expect(assignedGlobals("class = 1")).toEqual([]);
	});

	it("reads a js: value like a script, without its prefix", () => {
		expect(assignedGlobals("js:total = 1; return total")).toEqual(["total"]);
	});
});

describe("blockAssignedGlobals", () => {
	it("reads the code field and every js: value of a block", () => {
		expect(blockAssignedGlobals("jsrunner", { value: "a = 1" })).toEqual(["a"]);
		expect(blockAssignedGlobals("httprequest", { url: "js:b = 2; return 'x'", method: "GET" })).toEqual(["b"]);
		expect(blockAssignedGlobals("jsrunner", { value: "a = 1; a = 2", name: "c = 3" })).toEqual(["a"]);
	});
});
