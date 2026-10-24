import { describe, expect, it } from "bun:test";
import { triggerEntryPath } from "@fluxify/sdk/triggers";
import { diffManifests } from "../diff";
import type { PluginUser } from "../usage";
import { entry, manifest } from "./fixtures";

const NAME = "acme/streams";
const BLOCK = `${NAME}/read`;
const KIND = `${NAME}/poll`;
const REDIS = "11111111-1111-4111-8111-111111111111";
const MEMCACHED = "22222222-2222-4222-8222-222222222222";
const kinds = new Map([
	[REDIS, { group: "kv", variant: "Redis" }],
	[MEMCACHED, { group: "kv", variant: "Memcached" }],
]);
const store = (variants?: string[]) => ({
	store: { type: "integration", kind: "kv", ...(variants && { variants }) },
});

/** the same variant rule, for every resource kind with params */
const KINDS = {
	block: {
		manifest: (variants?: string[]) =>
			manifest(NAME, [entry(BLOCK, { permissions: { integrations: ["kv"] }, params: store(variants) })]),
		run: (before: object, after: object, value: string) => {
			const user: PluginUser = {
				kind: "route",
				id: "r1",
				name: "orders",
				inWorkingCopy: true,
				inProduction: false,
				nodes: [
					{ type: BLOCK, blockId: "n1", where: "working_copy", params: ["store"], handles: [], invoke: "sync", values: { store: value } },
				],
			};
			const d = diffManifests(before as never, after as never, [user], [], [], kinds);
			return { listed: d.changedVariants.map((c) => c.change), used: d.changedVariants.flatMap((c) => c.usedBy.map((u) => u.name)), d };
		},
	},
	trigger: {
		manifest: (variants?: string[]) => ({
			...manifest(NAME, []),
			triggers: [
				{ name: KIND, label: "Poll", icon: "data:x", permissions: { integrations: ["kv"] }, params: store(variants), retry: false, entry: triggerEntryPath(KIND) },
			],
		}),
		run: (before: object, after: object, value: string) => {
			const user = { id: "t1", name: "orders", kind: KIND, params: ["store"], values: { store: value } };
			const d = diffManifests(before as never, after as never, [], [], [user], kinds);
			return { listed: d.changedTriggers.map((c) => c.change), used: d.changedTriggers.flatMap((c) => c.usedBy.map((u) => u.name)), d };
		},
	},
};

describe.each(Object.keys(KINDS) as (keyof typeof KINDS)[])("upgrade diff: variants of a %s param", (kind) => {
	const { manifest: m, run } = KINDS[kind];

	it("narrowing breaks the users of a variant it drops", () => {
		const r = run(m(["Redis", "Memcached"]), m(["Redis"]), MEMCACHED);
		expect(r.listed).toEqual(["param store now takes only Redis"]);
		expect(r.used).toEqual(["orders"]);
		expect(r.d.blocking).toBe(true);
		expect(r.d.blockers[0]).toContain("now takes only Redis");
	});

	it("narrowing breaks nothing when every value still fits", () => {
		const r = run(m(["Redis", "Memcached"]), m(["Redis"]), REDIS);
		expect(r.listed).toEqual(["param store now takes only Redis"]);
		expect(r.d.blocking).toBe(false);
	});

	it("adding variants where every value fits, and widening, break nothing", () => {
		expect(run(m(), m(["Redis"]), REDIS).d.blocking).toBe(false);
		expect(run(m(), m(["Redis"]), MEMCACHED).d.blocking).toBe(true);
		const wider = run(m(["Redis"]), m(), REDIS);
		expect(wider.listed).toEqual(["param store now takes every variant"]);
		expect(wider.d.blocking).toBe(false);
		expect(run(m(["Redis"]), m(["Redis", "Memcached"]), REDIS).d.blocking).toBe(false);
	});

	it("an id of no known integration breaks nothing, and unchanged variants are not listed", () => {
		expect(run(m(["Redis", "Memcached"]), m(["Redis"]), "gone").d.blocking).toBe(false);
		expect(run(m(["Redis"]), m(["Redis"]), MEMCACHED).listed).toEqual([]);
	});
});
