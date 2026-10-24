import { describe, expect, it } from "bun:test";
import type { FluxifyManifest } from "@fluxify/sdk/blocks";
import { diffManifests } from "../diff";
import type { IntegrationUser } from "../integrationUsage";
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
			changedVariants: [],
			changedHandlesOrShape: [],
			addedPermissions: { integrations: [], appconfig: false },
			deprecations: [],
			addedIntegrations: [],
			removedIntegrations: [],
			changedIntegrations: [],
			addedTriggers: [],
			removedTriggers: [],
			changedTriggers: [],
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

describe("diffManifests: integrations (I6)", () => {
	type P = Record<string, { type: string; required?: boolean; default?: unknown }>;
	const variant = (name: string, configSchema: P, over: { group?: string; variant?: string } = {}) => ({
		name: `${NAME}/${name}`,
		label: name,
		icon: "data:x",
		group: over.group ?? "kv",
		variant: over.variant ?? "Hub",
		configSchema,
		secretParams: Object.keys(configSchema).filter((k) => configSchema[k]!.type === "secret"),
		hasTest: false,
		hasDescribe: false,
		hasInspect: false,
		entry: `dist/integrations/${name}.js`,
	});
	const withIntegrations = (...integrations: ReturnType<typeof variant>[]) =>
		({ ...old, integrations }) as unknown as FluxifyManifest;
	const base = { url: { type: "string", required: true }, token: { type: "secret", required: true } };
	const before = withIntegrations(variant("hub", base));
	const row: IntegrationUser = { id: "i1", name: "cache", group: "kv", variant: "Hub" };

	/** [what the new version does, its change line, breaking] */
	const cases: [string, P, string, boolean][] = [
		["removes a param", { url: base.url }, "param token removed", true],
		["adds an optional param", { ...base, port: { type: "number" } }, "optional param port added", false],
		["adds a required param", { ...base, port: { type: "number", required: true } }, "required param port added", true],
		["adds a required param with a default", { ...base, port: { type: "number", required: true, default: 1 } }, "optional param port added", false],
		["changes a param's type", { ...base, url: { type: "number", required: true } }, "param url changed type from string to number", true],
		["turns a secret plain", { ...base, token: { type: "string", required: true } }, "param token changed between secret and plain", true],
	];
	for (const [what, schema, change, breaking] of cases)
		it(`${what}: ${breaking ? "blocks while a row exists" : "never blocks"}`, () => {
			const next = withIntegrations(variant("hub", schema as never));
			const unused = diffManifests(before, next, []);
			expect(unused.changedIntegrations).toEqual([{ kind: "kv/Hub", change, breaking, usedBy: [] }]);
			expect(unused.blocking).toBe(false);
			expect(diffManifests(before, next, [], [row]).blocking).toBe(breaking);
		});

	it("an optional param made required blocks while a row exists", () => {
		const loose = withIntegrations(variant("hub", { ...base, region: { type: "string" } }));
		const strict = withIntegrations(variant("hub", { ...base, region: { type: "string", required: true } }));
		const diff = diffManifests(loose, strict, [], [row]);
		expect(diff.changedIntegrations.map((c) => c.change)).toEqual(["param region is now required"]);
		expect(diff.blockers).toEqual([
			'integration variant kv/Hub: param region is now required, but used by integration "cache"',
		]);
	});

	it("a removed or regrouped variant blocks while a row exists; an added one never does", () => {
		const gone = diffManifests(before, withIntegrations(), [], [row]);
		expect(gone.removedIntegrations).toEqual([{ kind: "kv/Hub", usedBy: [{ id: "i1", name: "cache" }] }]);
		expect(gone.blockers).toEqual(['integration variant kv/Hub is removed but used by integration "cache"']);
		const moved = diffManifests(before, withIntegrations(variant("hub", base, { group: "acme/crm" })), [], [row]);
		expect(moved.changedIntegrations[0]).toMatchObject({ kind: "kv/Hub", change: "now acme/crm/Hub", breaking: true });
		expect(moved.blocking).toBe(true);
		const added = diffManifests(before, withIntegrations(variant("hub", base), variant("two", base, { variant: "Two" })), [], [row]);
		expect([added.addedIntegrations, added.blocking]).toEqual([["kv/Two"], false]);
		// an unused variant goes freely
		expect(diffManifests(before, withIntegrations(), []).blocking).toBe(false);
	});
});
