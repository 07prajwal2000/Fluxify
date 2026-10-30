import { describe, expect, it } from "bun:test";
import { blocksOf, slack } from "../plugins/fixtures";
import { makePluginOutput } from "./pluginOutputType";
import { createResolver, type InferOutput, resolveInputType } from "./resolveInputType";

const BRANCHING = { in: ["target"], out: ["success", "failure"], body: [] };
const ONE_WAY = { in: ["target"], out: ["source"], body: [] };
const plugin = (name: string, handles: object, over: Record<string, unknown> = {}) => ({
	name,
	label: name,
	shape: "square",
	invoke: ["sync"],
	permissions: {},
	params: {},
	handles,
	deprecated: null,
	...over,
});

/** one block of each kind a plugin can declare */
const blocks = [
	plugin("acme/x/one", ONE_WAY, { output: "{ id: string }" }),
	plugin("acme/x/branch", BRANCHING, { output: "{ ok: true }" }),
	plugin("acme/x/both", BRANCHING, { output: { success: "{ ok: true }", failure: "string" } }),
	plugin("acme/x/failonly", BRANCHING, { output: { failure: "string" } }),
	plugin("acme/x/silent", ONE_WAY),
	plugin("acme/x/blank", ONE_WAY, { output: "  " }),
	plugin("acme/x/typed", ONE_WAY, {
		output: "import('zod').ZodType",
		outputPackages: { zod: "4.1.5", "@scope/pkg": "1.0.0" },
	}),
	plugin("acme/x/body", { ...ONE_WAY, body: [{ name: "tools", corner: "top-left" }] }, { output: "string" }),
];
const byType = blocksOf(slack(blocks)).byType;

const loaded: [string, string][] = [];
const ctx = (infer: InferOutput = async (source, input) => `${source}<${input}>`) => ({
	infer,
	loadDbMeta: async () => null,
	pluginOutput: makePluginOutput(byType, (name, version) => loaded.push([name, version])),
});

const node = (id: string, type: string) => ({ id, type, data: {} });
const runner = (id: string, value: string) => ({ id, type: "jsrunner", data: { value } });
const edge = (source: string, target: string, kind = "source") => ({
	source,
	target,
	sourceHandle: `${source}-${kind}`,
});
const typeAfter = (type: string, kind: string) =>
	resolveInputType("b", [node("a", type), runner("b", "B")], [edge("a", "b", kind)], ctx());

describe("plugin block output types", () => {
	it("types a one-way block's source with its string", async () => {
		expect(await typeAfter("acme/x/one", "source")).toBe("{ id: string }");
	});

	it("gives a string on a success/failure block to success only", async () => {
		expect(await typeAfter("acme/x/branch", "success")).toBe("{ ok: true }");
		expect(await typeAfter("acme/x/branch", "failure")).toBe("any");
	});

	it("types each handle from a record", async () => {
		expect(await typeAfter("acme/x/both", "success")).toBe("{ ok: true }");
		expect(await typeAfter("acme/x/both", "failure")).toBe("string");
	});

	it("leaves the handles a record skips as any", async () => {
		expect(await typeAfter("acme/x/failonly", "success")).toBe("any");
		expect(await typeAfter("acme/x/failonly", "failure")).toBe("string");
	});

	it("is any with no output, a blank one, a body handle or an unknown block", async () => {
		expect(await typeAfter("acme/x/silent", "source")).toBe("any");
		expect(await typeAfter("acme/x/blank", "source")).toBe("any");
		expect(await typeAfter("acme/x/body", "tools")).toBe("any");
		expect(await typeAfter("acme/x/gone", "source")).toBe("any");
	});

	it("is any without a plugin lookup, as before", async () => {
		const bare = { infer: ctx().infer, loadDbMeta: async () => null };
		const nodes = [node("a", "acme/x/one"), runner("b", "B")];
		expect(await resolveInputType("b", nodes, [edge("a", "b")], bare)).toBe("any");
	});

	it("unions with another upstream block", async () => {
		const nodes = [node("a", "acme/x/one"), runner("c", "C"), runner("b", "B")];
		const edges = [edge("a", "b"), edge("c", "b")];
		expect(await resolveInputType("b", nodes, edges, ctx())).toBe("({ id: string }) | (C<any>)");
	});

	it("is any in a union when a plugin block says nothing", async () => {
		const nodes = [node("a", "acme/x/silent"), runner("c", "C"), runner("b", "B")];
		expect(await resolveInputType("b", nodes, [edge("a", "b"), edge("c", "b")], ctx())).toBe("any");
	});

	it("feeds the declared type to the script after it", async () => {
		const nodes = [node("a", "acme/x/one"), runner("b", "B"), runner("c", "C")];
		const resolver = createResolver(nodes, [edge("a", "b"), edge("b", "c")], ctx());
		expect(await resolver.inputType("c")).toBe("B<{ id: string }>");
		expect(await resolver.outputType("a")).toBe("{ id: string }");
	});
});

describe("plugin output packages", () => {
	it("loads a used output's packages", async () => {
		loaded.length = 0;
		await typeAfter("acme/x/typed", "source");
		expect(loaded).toEqual([
			["zod", "4.1.5"],
			["@scope/pkg", "1.0.0"],
		]);
	});

	it("loads nothing for a block that declares no type", async () => {
		loaded.length = 0;
		await typeAfter("acme/x/one", "source");
		await typeAfter("acme/x/silent", "source");
		expect(loaded).toEqual([]);
	});
});
