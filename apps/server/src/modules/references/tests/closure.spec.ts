import { describe, expect, it } from "bun:test";
import { missingDependencies, prodUsers } from "../closure";
import type { BlockRow, HookSuite, ProdEntry, ProdGraph } from "../prodGraph";

/** a graph of promoted versions, written the short way */
function graph(spec: {
	entries?: Partial<ProdEntry>[];
	blocks?: Partial<BlockRow>[];
	middlewares?: { id: string; name?: string; prodVersionId?: string | null }[];
	hooks?: HookSuite[];
}): ProdGraph {
	const entries = new Map<string, ProdEntry>();
	for (const e of spec.entries ?? []) {
		const entry: ProdEntry = {
			kind: "route",
			id: "x",
			name: e.id ?? "x",
			versionId: `v-${e.id}`,
			blockTypes: new Set(),
			middlewares: [],
			chain: [],
			...e,
		};
		entries.set(`${entry.kind}:${entry.id}`, entry);
	}
	const blocks = (spec.blocks ?? []).map((b) => ({
		id: b.id!,
		name: b.name ?? b.id!,
		prodVersionId: b.prodVersionId === undefined ? `v-${b.id}` : b.prodVersionId,
		usage: b.usage ?? "flow",
	}));
	const middlewares = (spec.middlewares ?? []).map((m) => ({
		id: m.id,
		name: m.name ?? m.id,
		prodVersionId: m.prodVersionId === undefined ? `v-${m.id}` : m.prodVersionId,
	}));
	return {
		projectId: "p",
		entries,
		blocksByName: new Map(blocks.map((b) => [b.name, b])),
		blocksById: new Map(blocks.map((b) => [b.id, b])),
		middlewares: new Map(middlewares.map((m) => [m.id, m])),
		hookSuites: spec.hooks ?? [],
	} as ProdGraph;
}

const uses = (over: { blockTypes?: string[]; middlewares?: string[]; blockIds?: string[] }) => ({
	blockTypes: over.blockTypes ?? [],
	middlewares: over.middlewares ?? [],
	blockIds: over.blockIds ?? [],
});

describe("missingDependencies", () => {
	it("lists a direct dependency with no promoted version, with its kind, id and name", () => {
		const g = graph({
			blocks: [{ id: "b1", name: "tax", prodVersionId: null }, { id: "b2", name: "live" }],
			middlewares: [{ id: "m1", name: "audit", prodVersionId: null }],
		});
		expect(
			missingDependencies(g, uses({ blockTypes: ["tax", "live", "jsrunner"], middlewares: ["m1"] })),
		).toEqual([
			{ kind: "custom_block", id: "b1", name: "tax" },
			{ kind: "middleware", id: "m1", name: "audit" },
		]);
	});

	it("follows uses of uses through the promoted versions, not working copies", () => {
		// A is live and its promoted version calls B, which has no promoted version
		const g = graph({
			entries: [{ kind: "custom_block", id: "a", blockTypes: new Set(["b"]) }],
			blocks: [{ id: "a" }, { id: "b", prodVersionId: null }],
		});
		expect(missingDependencies(g, uses({ blockTypes: ["a"] }))).toEqual([
			{ kind: "custom_block", id: "b", name: "b" },
		]);
	});

	it("reaches a middleware's chain blocks", () => {
		const g = graph({
			entries: [{ kind: "middleware", id: "m", chain: ["c"] }],
			blocks: [{ id: "c", prodVersionId: null, usage: "middleware" }],
			middlewares: [{ id: "m" }],
		});
		expect(missingDependencies(g, uses({ middlewares: ["m"] }))).toEqual([
			{ kind: "custom_block", id: "c", name: "c" },
		]);
	});

	it("ends on a cycle, and does not list the version being checked", () => {
		const g = graph({
			entries: [
				{ kind: "custom_block", id: "a", blockTypes: new Set(["b"]) },
				{ kind: "custom_block", id: "b", blockTypes: new Set(["a"]) },
			],
			blocks: [{ id: "a" }, { id: "b" }],
		});
		expect(missingDependencies(g, uses({ blockTypes: ["a"] }))).toEqual([]);
		// B's own candidate calls A, whose promoted version calls B: B is not its own dependency
		const lacking = graph({
			entries: [{ kind: "custom_block", id: "a", blockTypes: new Set(["b"]) }],
			blocks: [{ id: "a" }, { id: "b", prodVersionId: null }],
		});
		expect(missingDependencies(lacking, uses({ blockTypes: ["a"] }), "b")).toEqual([]);
	});

	it("leaves a name that is no custom block to the compile check", () => {
		expect(missingDependencies(graph({}), uses({ blockTypes: ["jsrunner", "deleted_block"] }))).toEqual([]);
	});
});

describe("prodUsers", () => {
	const route = (id: string, over: Partial<ProdEntry> = {}): Partial<ProdEntry> => ({ kind: "route", id, ...over });

	it("finds routes and workflows that use the block directly or through other blocks and middlewares", () => {
		const g = graph({
			entries: [
				route("direct", { blockTypes: new Set(["leaf"]) }),
				{ kind: "workflow", id: "wf", blockTypes: new Set(["mid"]) },
				{ kind: "custom_block", id: "mid", blockTypes: new Set(["leaf"]) },
				route("viaMiddleware", { middlewares: ["mw"] }),
				{ kind: "middleware", id: "mw", chain: ["leaf"] },
				route("unrelated", { blockTypes: new Set(["other"]) }),
			],
			blocks: [{ id: "leaf" }, { id: "mid" }, { id: "other" }],
			middlewares: [{ id: "mw" }],
		});
		const users = prodUsers(g, { kind: "custom_block", id: "leaf", name: "leaf" });
		expect(users.targets.map((t) => t.id).sort()).toEqual(["direct", "viaMiddleware", "wf"]);
		expect([...users.blockIds].sort()).toEqual(["leaf", "mid"]);
	});

	it("finds the routes that attach a middleware, and no custom blocks", () => {
		const g = graph({
			entries: [route("r1", { middlewares: ["mw"] }), route("r2", { blockTypes: new Set(["mw"]) })],
			middlewares: [{ id: "mw" }],
		});
		const users = prodUsers(g, { kind: "middleware", id: "mw", name: "mw" });
		expect(users.targets.map((t) => t.id)).toEqual(["r1"]);
		expect(users.blockIds.size).toBe(0);
	});

	it("adds the suites that hook a block on the way, when their target is promoted", () => {
		const hook = (id: string, prodVersionId: string | null, blockIds: string[]): HookSuite => ({
			id,
			name: id,
			target: { kind: "route", id: `t-${id}`, name: id, prodVersionId },
			blockIds,
		});
		const g = graph({
			entries: [{ kind: "custom_block", id: "setup", blockTypes: new Set(["leaf"]) }],
			blocks: [{ id: "leaf" }, { id: "setup", usage: "test" }],
			hooks: [
				hook("direct", "v", ["leaf"]),
				hook("viaSetup", "v", ["setup"]),
				hook("unpromoted", null, ["leaf"]),
				hook("elsewhere", "v", ["something-else"]),
			],
		});
		const users = prodUsers(g, { kind: "custom_block", id: "leaf", name: "leaf" });
		expect(users.hookSuites.map((s) => s.id).sort()).toEqual(["direct", "viaSetup"]);
	});

	it("ends on a cycle", () => {
		const g = graph({
			entries: [
				{ kind: "custom_block", id: "a", blockTypes: new Set(["b"]) },
				{ kind: "custom_block", id: "b", blockTypes: new Set(["a"]) },
				route("r", { blockTypes: new Set(["a"]) }),
			],
			blocks: [{ id: "a" }, { id: "b" }],
		});
		const users = prodUsers(g, { kind: "custom_block", id: "b", name: "b" });
		expect(users.targets.map((t) => t.id)).toEqual(["r"]);
	});
});
