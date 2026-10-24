import { describe, expect, it } from "bun:test";
import { block, fluxifyManifestSchema, integration, param } from "../blocks.js";
import { canonicalVariant, variantAllowed } from "../integrations.js";
import { runBlock, runTrigger } from "../testing.js";
import { trigger } from "../triggers.js";

const meta = { name: "acme/streams", url: "https://github.com/acme/streams", sdk: ">=2026.10.2001" };
const own = {
	name: "acme/streams/store",
	entry: "dist/integrations/store.js",
	label: "Store",
	icon: "store.svg",
	group: "kv",
	variant: "acme-kv",
	configSchema: {},
	secretParams: [],
	hasTest: false,
	hasDescribe: false,
	hasInspect: false,
};

/** every resource kind that takes params, as the manifest holds one with `params` */
const KINDS = {
	block: (params: object) => ({
		blocks: {
			"acme/streams/read": {
				name: "acme/streams/read",
				entry: "dist/blocks/read.js",
				label: "Read",
				shape: "square",
				invoke: ["sync"],
				permissions: { integrations: ["kv", "acme/crm"] },
				params,
				handles: { in: ["target"], out: ["source"], body: [] },
				deprecated: null,
			},
		},
	}),
	trigger: (params: object) => ({
		blocks: {},
		triggers: [
			{
				name: "acme/streams/poll",
				entry: "dist/triggers/poll.js",
				label: "Poll",
				icon: "poll.svg",
				permissions: { integrations: ["kv", "acme/crm"] },
				params,
				retry: false,
			},
		],
	}),
};

const manifest = (kind: keyof typeof KINDS, variants?: string[], k = "kv") => ({
	...meta,
	...KINDS[kind]({ store: { type: "integration", kind: k, ...(variants && { variants }) } }),
	integrations: [own, { ...own, name: "acme/streams/crm", entry: "dist/integrations/crm.js", group: "acme/crm", variant: "Hub" }],
});
const errors = (m: unknown) => {
	const r = fluxifyManifestSchema.safeParse(m);
	return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe.each(Object.keys(KINDS) as (keyof typeof KINDS)[])("variants on a %s param", (kind) => {
	it("is optional", () => expect(errors(manifest(kind, undefined))).toEqual([]));

	it("takes built-in names, aliases and the plugin's own variants of the group", () => {
		expect(errors(manifest(kind, ["Redis"]))).toEqual([]);
		expect(errors(manifest(kind, ["Redis", "Memcached", "acme-kv"]))).toEqual([]);
		expect(errors(manifest(kind, ["Hub"], "acme/crm"))).toEqual([]);
	});

	it("refuses an empty list, a repeat and a name the group does not have", () => {
		expect(errors(manifest(kind, []))[0]).toContain("at least one variant");
		expect(errors(manifest(kind, ["Redis", "Redis"]))[0]).toContain("unique");
		expect(errors(manifest(kind, ["Mongo"]))[0]).toBe(
			"param 'store': 'Mongo' is not a variant of kv; known: Redis, Memcached, acme-kv",
		);
		// a variant of another group is not one of this group's
		expect(errors(manifest(kind, ["acme-kv"], "acme/crm"))[0]).toContain("known: Hub");
	});

	it("refuses variants on a kind that names a variant already", () => {
		expect(errors(manifest(kind, ["Redis"], "kv/Redis"))[0]).toContain("names a variant already");
	});
});

describe("variantAllowed", () => {
	it("matches names and aliases either way; no list takes all", () => {
		expect(canonicalVariant("observability", "Open Telemetry Logs")).toBe("Open Telemetry");
		expect(variantAllowed(["Open Telemetry"], "observability", "Open Telemetry Logs")).toBe(true);
		expect(variantAllowed(["Open Telemetry Logs"], "observability", "Open Telemetry")).toBe(true);
		expect(variantAllowed(["Redis"], "kv", "Memcached")).toBe(false);
		expect(variantAllowed(undefined, "kv", "Memcached")).toBe(true);
	});
});

const redis = { xack: () => 1 };
const kvClient = { get: async () => null, set: async () => {}, setex: async () => {}, delete: async () => {} };

describe("connection in the harnesses", () => {
	const read = block({
		name: "acme/streams/read",
		label: "Read",
		permissions: { integrations: ["kv"] },
		params: { store: param.integration({ kind: "kv", variants: ["Redis"], required: true }) },
		handles: { out: [] },
		async run({ params, ctx }) {
			const c = await ctx.integrations.connection(params.store);
			return { output: { variant: c.variant, same: c.client === kvClient, raw: c.raw } };
		},
	});

	it("runBlock: a fake hands out its variant and raw", async () => {
		const r = await runBlock(read, {
			params: { store: "s1" },
			ctx: { integrations: { s1: { kind: "kv/Redis", client: kvClient, raw: redis } } },
		});
		expect(r.output).toEqual({ variant: "Redis", same: true, raw: redis });
	});

	it("runBlock: an ungranted kind is refused as `get` refuses it", async () => {
		const r = await runBlock(read, {
			params: { store: "s1" },
			ctx: { integrations: { s1: { kind: "database/PostgreSQL", client: {}, raw: {} } } },
		});
		expect(r.error?.message).toContain("was not granted database integrations");
	});

	it("runBlock: a plugin's kv variant gives what its connect returned", async () => {
		const mine = { ...kvClient, mine: true };
		const store = integration({
			name: "acme/streams/store",
			label: "Store",
			icon: "./store.svg",
			group: "kv",
			variant: "acme-kv",
			config: {},
			connect: () => mine,
		});
		const r = await runBlock(read, {
			params: { store: "s1" },
			ctx: { integrations: { s1: { integration: store, config: {} } } },
		});
		expect(r.output).toMatchObject({ variant: "acme-kv", raw: mine });
	});

	it("runTrigger: the same, from start", async () => {
		const poll = trigger({
			name: "acme/streams/poll",
			label: "Poll",
			icon: "./poll.svg",
			permissions: { integrations: ["kv"] },
			params: { store: param.integration({ kind: "kv", variants: ["Redis"], required: true }) },
			async start(ctx) {
				const c = await ctx.integrations.connection(ctx.params.store);
				void ctx.emit([{ variant: c.variant, raw: c.raw }]).catch(() => {});
				return async () => {};
			},
		});
		const run = await runTrigger(poll, {
			params: { store: "s1" },
			integrations: { s1: { kind: "kv/Redis", client: kvClient, raw: redis } },
		});
		const emitted = await run.nextEmit();
		expect(emitted.events).toEqual([{ variant: "Redis", raw: redis }]);
		emitted.resolve();
		await run.stop();
	});
});
