import { describe, expect, it } from "bun:test";
import { block, handle, manifestEntrySchema, toManifestEntry } from "../blocks.js";

const run = () => ({ output: 1 });
// a loose definition, for the cases the types would reject before runtime
const define = (def: Record<string, unknown>) => () =>
	block({ name: "acme/x/b", label: "B", run, ...def } as any);
const branching = { out: [handle.out("success"), handle.out("failure")] } as const;
const issues = (entry: unknown) =>
	manifestEntrySchema.safeParse(entry).error?.issues.map((i) => i.message) ?? [];

describe("output", () => {
	it("reaches the manifest, and round-trips through the schema", () => {
		const entry = toManifestEntry(
			block({
				name: "acme/x/b",
				label: "B",
				invoke: ["sync"],
				handles: branching,
				output: { success: "{ id: string }", failure: "string" },
				outputPackages: { zod: "4.1.5", "@scope/pkg": "1.0.0-beta.1" },
				run,
			}),
		);
		expect(entry.output).toEqual({ success: "{ id: string }", failure: "string" });
		expect(entry.outputPackages).toEqual({ zod: "4.1.5", "@scope/pkg": "1.0.0-beta.1" });
		expect(manifestEntrySchema.parse(entry)).toEqual(entry);
	});

	it("is left out of the manifest when the block sets neither", () => {
		const entry = toManifestEntry(block({ name: "acme/x/b", label: "B", run }));
		expect("output" in entry || "outputPackages" in entry).toBe(false);
	});

	it("takes one string, or one per output handle", () => {
		expect(define({ output: "{ id: string }" })).not.toThrow();
		expect(define({ output: { source: "string" } })).not.toThrow();
		expect(define({ handles: branching, invoke: ["sync"], output: { failure: "string" } })).not.toThrow();
	});

	it("refuses a handle the block does not have as an output", () => {
		expect(define({ output: { success: "string" } })).toThrow("'success', which is not an output handle");
		expect(define({ output: { target: "string" } })).toThrow();
	});

	it("refuses an output on a block with no output handle", () => {
		expect(define({ handles: { out: [] }, output: "string" })).toThrow("has no output handle");
	});

	it("caps a type at 2048 characters", () => {
		expect(define({ output: "a".repeat(2048) })).not.toThrow();
		expect(define({ output: "a".repeat(2049) })).toThrow();
		expect(define({ output: { source: "a".repeat(2049) } })).toThrow();
	});
});

describe("outputPackages", () => {
	it("takes up to 5 packages, scoped or not", () => {
		const five = Object.fromEntries(["a", "b", "@c/d", "e", "f"].map((n) => [n, "1.2.3"]));
		expect(define({ outputPackages: five })).not.toThrow();
		expect(define({ outputPackages: { ...five, g: "1.2.3" } })).toThrow("at most 5 packages");
	});

	it.each([["Zod"], ["has space"], ["@scope"], ["@scope/"], [""], ["a/b"], ["../x"]])(
		"refuses the package name %p",
		(name) => {
			expect(define({ outputPackages: { [name]: "1.0.0" } })).toThrow("npm package name");
		},
	);

	it.each([["^1.0.0"], ["latest"], ["1.0"], [">=1.0.0"], ["1.0.0 "], ["*"], ["1.0.0-"]])(
		"refuses the version %p, which is not exact",
		(version) => {
			expect(define({ outputPackages: { zod: version } })).toThrow("exact version");
		},
	);

	it("is checked on a hand-written manifest entry too", () => {
		const entry = toManifestEntry(block({ name: "acme/x/b", label: "B", run }));
		expect(issues({ ...entry, outputPackages: { zod: "latest" } })).toEqual([
			"must be an exact version, like 1.2.3",
		]);
		expect(issues({ ...entry, output: { failure: "string" } })).toEqual([
			"output names 'failure', which is not an output handle of this block",
		]);
	});
});
