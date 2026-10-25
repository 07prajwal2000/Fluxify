import { describe, expect, it } from "bun:test";
import { pureExpression } from "./pureExpression";
import { scopeFor } from "./scope";

const rename = { input: "$in", params: "$state.params" };

/** what the compiler emitted before: an async function inside the scope proxy */
async function wrapped(code: string, $in: unknown, params: unknown, vars: Record<string, unknown>) {
	const fn = new Function(
		"$scope",
		`return async function (input, params) { with ($scope) {\n${code}\n} }`,
	)(scopeFor(vars));
	return fn($in, params);
}

function inlined(expr: string, $in: unknown, params: unknown) {
	return new Function("$in", "$state", `return ${expr}`)($in, { params });
}

describe("pureExpression", () => {
	const inputs: unknown[] = [null, undefined, 0, "", "abc", { url: "u", n: 2, a: [1, 2] }, [3]];
	it.each([
		"return input !== null",
		"return input",
		"return `url:${input}`;",
		"return input?.url",
		"return input?.a?.[1] ?? 'none'",
		"return input === undefined ? params?.x : typeof input",
		"return (input?.n ?? 0) * 2 + 1 / 4 - 3 % 2",
		"return !input || input.length > 1",
		'return "a\\"b" + `x${input?.n} \\${y}`',
		"return 0x1f + 1_000 + 2e3 + .5 > 0 && 5n === 5n",
		"return params",
		"return { error: 'not_found' }",
		"return { id: input?.n, url: input?.url, 'x-y': [input, 1], 2: { input: null } }",
		"return { input, params, }",
		"return {}",
		"return [{ a: input ? { b: 1 } : 2 }, (input)]",
		"return `${ {a: input}.a }`",
	])("%s gives what the wrapped form gives", async (code) => {
		const expr = pureExpression(code, rename);
		expect(expr).toBeString();
		for (const input of inputs) {
			const vars = { input: "shadow", params: "shadow", url: "var" };
			expect(inlined(expr!, input, { x: 1 })).toEqual(await wrapped(code, input, { x: 1 }, vars));
		}
	});

	it("renames only the variables, never a property or a string", () => {
		expect(pureExpression("return input.input + 'input' + params.params", rename)).toBe(
			"(($in).input + 'input' + ($state.params).params)",
		);
	});

	it.each([
		// another name resolves through the scope: a graph variable or a global
		"return url",
		"return String(input)",
		"return Math.max",
		"return this",
		"return constructor",
		// calls may return a promise the wrapper awaited
		"return input.toString()",
		"return input?.()",
		"return input`tag`",
		"return (input)(1)",
		"return new Date()",
		"return await input",
		// writes
		"return input = 1",
		"return input++",
		"return --input",
		"return delete input.a",
		// more than one statement, or not a return
		"const x = 1; return x",
		"return input; return 2",
		"input",
		"return\ninput",
		"return",
		// object literal forms that read a free name or run code
		"return { url }",
		"return { ...input }",
		"return [...input]",
		"return { [input]: 1 }",
		"return { f() { return 1 } }",
		"return { get a() { return 1 } }",
		"return { a: url }",
		"return { a: 1 ",
		"return a: 1 }",
		// syntax the scan does not follow
		"return () => input",
		"return /input/.source",
		"return typeof /input/",
		"return input // comment",
		"return input /* comment */",
		"return `${'}'}`",
		"return `${`nested`}`",
		"return 'unterminated",
		"return `${input.toString()}`",
	])("%s is left to the wrapper", (code) => {
		expect(pureExpression(code, rename)).toBeUndefined();
	});
});
