import { describe, expect, it } from "bun:test";
import { block, param, toManifestEntry } from "../blocks.js";

const run = () => ({ output: 1 });
// a loose definition, for the cases the types would reject before runtime
const define = (def: Record<string, unknown>) => () => block({ name: "acme/x/b", label: "B", run, ...def } as any);

describe("string param minLength and pattern", () => {
	it("refuses a pattern that is not a regular expression, and a default that breaks the rules", () => {
		expect(define({ params: { s: param.string({ pattern: "([" }) } })).toThrow(
			"string pattern is not a regular expression",
		);
		expect(define({ params: { s: param.string({ minLength: -1 }) } })).toThrow();
		expect(define({ params: { s: param.string({ minLength: 1.5 }) } })).toThrow();
		expect(define({ params: { s: param.string({ minLength: 3, default: "ab" }) } })).toThrow(
			"string default must be at least 3 characters, got 2",
		);
		expect(define({ params: { s: param.string({ pattern: "^[a-z]+$", default: "A" }) } })).toThrow(
			"string default must match ^[a-z]+$",
		);
	});

	it("writes them into the manifest entry, and run refuses a value that breaks them", () => {
		const b = block({
			name: "acme/x/slug",
			label: "Slug",
			params: { s: param.string({ minLength: 3, pattern: "^[a-z-]+$" }) },
			run: ({ params }) => ({ output: params.s }),
		});
		expect(toManifestEntry(b).params.s).toMatchObject({ minLength: 3, pattern: "^[a-z-]+$" });
		const call = (s: unknown) => b.run({ params: { s } } as never);
		expect(() => call("ab")).toThrow("param 's' must be at least 3 characters, got 2");
		expect(() => call("ABC")).toThrow("param 's' must match ^[a-z-]+$");
		expect((call("abc") as { output: unknown }).output).toBe("abc");
	});
});
