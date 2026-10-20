import { describe, expect, it } from "bun:test";
import type { FluxifyManifest } from "@fluxify/sdk/blocks";
import { diffManifests } from "../diff";
import type { PluginUser } from "../usage";
import { entry, manifest } from "./fixtures";

const NAME = "acme/echo";
const A = `${NAME}/a`;
const B = `${NAME}/b`;
const m = (...blocks: ReturnType<typeof entry>[]) => manifest(NAME, blocks) as unknown as FluxifyManifest;

const user = (nodes: Partial<PluginUser["nodes"][number]>[]): PluginUser => ({
	kind: "route",
	id: "r1",
	name: "orders",
	inWorkingCopy: true,
	inProduction: false,
	nodes: nodes.map((n) => ({
		type: A,
		blockId: "n1",
		where: "working_copy",
		params: [],
		handles: [],
		invoke: "sync",
		...n,
	})),
});
const ref = { kind: "route", id: "r1", name: "orders" };

const old = m(
	entry(A, {
		params: { url: { type: "string" }, retries: { type: "number" } },
		invoke: ["sync", "async"],
		handles: { in: ["target"], out: ["success", "failure"], body: [{ name: "each", corner: "top-right" }] },
	}),
	entry(B),
);

describe("diffManifests", () => {
	it("an identical manifest changes nothing", () => {
		const diff = diffManifests(old, old, [user([{ params: ["url"] }])]);
		expect(diff).toEqual({
			addedBlocks: [],
			removedBlocks: [],
			removedParams: [],
			removedHandles: [],
			changedInvoke: [],
			changedHandlesOrShape: [],
			addedPermissions: { integrations: [], appconfig: false },
			deprecations: [],
			blocking: false,
			blockers: [],
		});
	});

	it("lists every removal, and blocks only on what a node uses", () => {
		const next = m(
			entry(A, {
				params: { url: { type: "string" } },
				invoke: ["sync"],
				handles: { in: ["target"], out: ["success", "failure"], body: [] },
				shape: "wide",
			}),
			entry(`${NAME}/c`),
		);
		const unused = diffManifests(old, next, []);
		expect(unused.removedBlocks).toEqual([{ block: B, usedBy: [] }]);
		expect(unused.removedParams).toEqual([{ block: A, param: "retries", usedBy: [] }]);
		expect(unused.removedHandles).toEqual([{ block: A, handle: "each", usedBy: [] }]);
		expect(unused.changedInvoke).toEqual([{ block: A, removed: ["async"], added: [], usedBy: [] }]);
		expect(unused.changedHandlesOrShape.map((c) => [c.block, c.before.shape, c.after.shape])).toEqual([
			[A, "square", "wide"],
		]);
		expect(unused.addedBlocks).toEqual([`${NAME}/c`]);
		expect(unused.blocking).toBe(false);

		// the same diff against a project that uses each removed thing
		const used = diffManifests(old, next, [
			user([
				{ params: ["retries"], handles: ["each"], invoke: "async" },
				{ type: B, blockId: "n2" },
			]),
		]);
		expect(used.blocking).toBe(true);
		expect(used.removedBlocks[0]!.usedBy).toEqual([ref]);
		expect(used.removedParams[0]!.usedBy).toEqual([ref]);
		expect(used.removedHandles[0]!.usedBy).toEqual([ref]);
		expect(used.changedInvoke[0]!.usedBy).toEqual([ref]);
		expect(used.blockers).toHaveLength(4);
		expect(used.blockers[1]).toBe(`param retries of ${A} is removed but set by route "orders"`);
	});

	it("a node calling with a mode that stays is not blocked by another mode going", () => {
		const next = m(entry(A, { ...old.blocks[A], invoke: ["sync"] } as never), entry(B));
		expect(diffManifests(old, next, [user([{ invoke: "sync" }])]).blocking).toBe(false);
	});

	it("reports permissions the new version adds", () => {
		const next = m(entry(A, { ...old.blocks[A], permissions: { integrations: ["kv"], appconfig: true } } as never), entry(B));
		expect(diffManifests(old, next, []).addedPermissions).toEqual({ integrations: ["kv"], appconfig: true });
	});

	it("lists deprecations of blocks, params and handles, and whether they are in use", () => {
		const next = m(
			entry(A, {
				...old.blocks[A],
				deprecated: "use b instead; removed in 2027",
				params: { url: { type: "string" }, retries: { type: "number", deprecated: "always 3 now" } },
				handles: {
					in: ["target"],
					out: ["success", "failure"],
					body: [{ name: "each", corner: "top-right" }],
					deprecated: { each: "use a loop" },
				},
			} as never),
			entry(B),
		);
		const diff = diffManifests(old, next, [user([{ params: ["url"], handles: ["each"] }])]);
		expect(diff.deprecations).toEqual([
			{ block: A, message: "use b instead; removed in 2027", inUse: true },
			{ block: A, param: "retries", message: "always 3 now", inUse: false },
			{ block: A, handle: "each", message: "use a loop", inUse: true },
		]);
		expect(diff.blocking).toBe(false);
	});
});
