import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { build } from "../src/build";
import { cleanup, makePlugin, NODE_MODULES } from "./helpers";

afterAll(cleanup);

const OUTS = 'handle.out("success"), handle.out("failure")';

/** a block `acme/t/<name>`; `outs` are the out handles (none: the default `source`) */
const blk = (name: string, run: string, { before = "", extra = "", outs = "" } = {}) =>
	`import { block, handle } from "@fluxify/sdk/blocks";
import type { LanguageModelUsage } from "ai";
${before}
export default block({
	name: "acme/t/${name}",
	label: "T",
	docs: "Docs.",
	${outs ? `handles: { out: [${outs}] }, invoke: ["sync"],` : ""}
	${extra}
	${run}
});
`;

const wide = Array.from({ length: 120 }, (_, i) => `property_number_${i}: "x"`).join(", ");

const BLOCKS: Record<string, string> = {
	single: blk("single", 'async run() { return { output: { id: "a", count: 1, ok: true } }; }'),
	sync: blk("sync", "run() { return { output: [1, 2] }; }"),
	split: blk(
		"split",
		`run({ params }) {
		if (params) return { output: { id: "x" }, handle: "success" };
		return { output: "boom", handle: "failure" };
	}`,
		{ outs: OUTS },
	),
	fallback: blk("fallback", "run() { return { output: { a: 1 } }; }", { outs: OUTS }),
	unknown: blk("unknown", "run() { return { output: JSON.parse('1') }; }"),
	none: blk("none", "run() {}"),
	override: blk(
		"override",
		`run({ params }) {
		if (params) return { output: { id: 1 }, handle: "success" };
		return { output: { reason: "x" }, handle: "failure" };
	}`,
		{ outs: OUTS, extra: 'output: { success: "string" },' },
	),
	owntext: blk("owntext", "run() { return { output: { id: 1 } }; }", {
		extra: 'output: "Record<string, unknown>",',
	}),
	own: blk("own", "run() { return { output: { user: user(), tags: [user()] } }; }", {
		before: `interface Address { city: string; zip?: string | undefined }
interface User { name: string; address: Address; role: "a" | "b"; at: Date; "x-key": number; run(): void }
const user = (): User => ({} as User);`,
	}),
	deep: blk("deep", "run() { return { output: { a: { b: { c: { d: { e: 1 } } } } } }; }"),
	cycle: blk("cycle", "run() { return { output: node() }; }", {
		before: `interface Node { next: Node; v: number }
const node = (): Node => ({} as Node);`,
	}),
	pkg: blk("pkg", "run() { return { output: { usage: {} as LanguageModelUsage } }; }"),
	pkgkept: blk("pkgkept", "run() { return { output: { usage: {} as LanguageModelUsage } }; }", {
		extra: 'outputPackages: { ai: "1.0.0" },',
	}),
	shapes: blk(
		"shapes",
		`run({ params }) {
		if (params) return { output: { text: "a", steps: 1, usage: {} as LanguageModelUsage, finishReason: "stop" as FinishReason } };
		return { output: { text: "b", aborted: true } };
	}`,
		{ before: 'import type { FinishReason } from "ai";' },
	),
	wide: blk("wide", `run() { return { output: { ${wide} } }; }`),
	nested: blk("nested", "run() { return { output: { list: [1] as number[], pair: [1, 'a'] as [number, string], m: new Map<string, number>(), f: (() => 1) as () => number, maybe: 1 as number | undefined } }; }"),
};

let root: string;
let manifest: Awaited<ReturnType<typeof build>>["manifest"];
let warnings: string[];
const entry = (name: string) => manifest.blocks[`acme/t/${name}`];

beforeAll(async () => {
	root = await makePlugin(
		{
			"src/blocks/hello.ts": null,
			...Object.fromEntries(Object.entries(BLOCKS).map(([n, s]) => [`src/blocks/${n}.ts`, s])),
		},
		{},
	);
	({ manifest, warnings } = await build(root));
}, 180_000);

describe("inferred output types", () => {
	it("types a single-handle block, sync or async", () => {
		expect(entry("single").output).toBe("{ id: string; count: number; ok: boolean }");
		expect(entry("sync").output).toBe("number[]");
		expect(entry("single").outputPackages).toBeUndefined();
	});

	it("splits a union of returns by the handle, and defaults to the first", () => {
		expect(entry("split").output).toEqual({ success: "{ id: string }", failure: "string" });
		expect(entry("fallback").output).toBe("{ a: number }");
	});

	it("emits nothing for an unknown output or no return", () => {
		expect(entry("unknown").output).toBeUndefined();
		expect(entry("none").output).toBeUndefined();
	});

	it("keeps the author's output and fills only the handles they left out", () => {
		expect(entry("override").output).toEqual({
			success: "string",
			failure: "{ reason: string }",
		});
		expect(entry("owntext").output).toBe("Record<string, unknown>");
	});

	it("expands the plugin's own interfaces and keeps global types by name", () => {
		const user =
			'{ name: string; address: { city: string; zip?: string }; role: "a" | "b"; at: Date; "x-key": number; run: (...args: any[]) => any }';
		expect(entry("own").output).toBe(`{ user: ${user}; tags: ${user}[] }`);
		expect(entry("nested").output).toBe(
			"{ list: number[]; pair: [number, string]; m: Map<string, number>; f: (...args: any[]) => any; maybe: undefined | number }",
		);
	});

	it("falls back to any past the depth cap and on a cycle", () => {
		expect(entry("deep").output).toBe("{ a: { b: { c: { d: any } } } }");
		expect(entry("cycle").output).toBe("{ next: any; v: number }");
	});

	it("refers to a type an npm package exports, with the installed version", async () => {
		const { version } = await Bun.file(join(NODE_MODULES, "ai", "package.json")).json();
		expect(entry("pkg").output).toBe('{ usage: import("ai").LanguageModelUsage }');
		expect(entry("pkg").outputPackages).toEqual({ ai: version });
		// the author's version of a package wins
		expect(entry("pkgkept").outputPackages).toEqual({ ai: "1.0.0" });
	});

	it("merges the object shapes of one handle, so each field completes with its type", () => {
		expect(entry("shapes").output).toBe(
			'{ text: string; steps?: number; usage?: import("ai").LanguageModelUsage; finishReason?: import("ai").FinishReason; aborted?: boolean }',
		);
	});

	it("drops a type over the limit, with a warning", () => {
		expect(entry("wide").output).toBeUndefined();
		expect(warnings).toEqual([
			expect.stringMatching(/^acme\/t\/wide: the output type of 'source' is \d+ characters, over the limit of 2048/),
		]);
	});

	it("writes what it inferred into a valid fluxify.json", async () => {
		const written = fluxifyManifestSchema.parse(await Bun.file(join(root, "fluxify.json")).json());
		expect(written).toEqual(manifest);
		expect(written.blocks["acme/t/single"].output).toBe("{ id: string; count: number; ok: boolean }");
	});
});
