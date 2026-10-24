// Type tests for `ctx.integrations.connection` (#973): compiled by `bun run typecheck`, never run.
import type { Redis } from "ioredis";
import type Memcached from "memcached";
import { block, type IntegrationId, integration, param } from "../blocks.js";
import type { KvAdapter } from "../integrations.js";
import { trigger } from "../triggers.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
	? true
	: false;
const assert = <T extends true>() => {};

block({
	name: "acme/streams/read",
	label: "Read",
	permissions: { integrations: ["kv"] },
	handles: { out: [] },
	params: {
		redis: param.integration({ kind: "kv", variants: ["Redis"], required: true }),
		either: param.integration({ kind: "kv", variants: ["Redis", "Memcached"], required: true }),
		any: param.integration({ kind: "kv", required: true }),
		byKind: param.integration({ kind: "kv/Redis", required: true }),
		mine: param.integration({ kind: "kv", variants: ["Redis", "acme-kv"], required: true }),
	},
	async run({ params, ctx }) {
		// the branded value is still a string, and a plain string is still a value
		const asString: string = params.redis;
		const fromString: IntegrationId<"kv", "Redis"> = "an-id";
		void [asString, fromString];

		// one variant: narrowed already
		const one = await ctx.integrations.connection(params.redis);
		assert<Equal<typeof one.variant, "Redis">>();
		assert<Equal<typeof one.raw, Redis>>();
		assert<Equal<typeof one.client, KvAdapter>>();
		await one.raw.xack("stream", "group", "1-0");

		// a kind that names its variant reads the same
		const kind = await ctx.integrations.connection(params.byKind);
		assert<Equal<typeof kind.raw, Redis>>();

		// two: narrow on `variant` first
		const two = await ctx.integrations.connection(params.either);
		assert<Equal<typeof two.variant, "Redis" | "Memcached">>();
		// @ts-expect-error raw is a union until narrowed
		await two.raw.xack("stream", "group", "1-0");
		if (two.variant === "Redis") await two.raw.xack("stream", "group", "1-0");
		else assert<Equal<typeof two.raw, Memcached>>();

		// a plugin's variant, listed by name: its raw is unknown
		const own = await ctx.integrations.connection(params.mine);
		if (own.variant === "acme-kv") assert<Equal<typeof own.raw, unknown>>();

		// no variants: every built-in one, plus any a plugin adds
		const all = await ctx.integrations.connection(params.any);
		assert<Equal<typeof all.variant, string>>();
		assert<Equal<typeof all.raw, unknown>>();
		assert<Equal<typeof all.client, KvAdapter>>();

		// a plain string: the loosest
		const loose = await ctx.integrations.connection("an-id" as string);
		assert<Equal<typeof loose, { variant: string; client: unknown; raw: unknown }>>();

		// `get` is unchanged
		const kv = await ctx.integrations.get<"kv">(params.either);
		assert<Equal<typeof kv, KvAdapter>>();
	},
});

const store = integration({
	name: "acme/streams/store",
	label: "Store",
	icon: "./store.svg",
	group: "acme/store",
	variant: "Fancy",
	config: {},
	connect: () => ({ fancy: true as const }),
});

trigger({
	name: "acme/streams/poll",
	label: "Poll",
	icon: "./poll.svg",
	permissions: { integrations: ["acme/store", "database"] },
	params: {
		store: param.integration({ kind: "acme/store", required: true }),
		db: param.integration({ kind: "database", variants: ["PostgreSQL", "MySQL"] }),
	},
	async start(ctx) {
		// a plugin's own integration: raw is what its `connect` returned
		const conn = await ctx.integrations.connection<typeof store>(ctx.params.store);
		assert<Equal<typeof conn.raw, { fancy: true }>>();

		const db = await ctx.integrations.connection(ctx.params.db);
		if (db.variant === "PostgreSQL") assert<Equal<typeof db.raw, Bun.SQL>>();
		return async () => {};
	},
});
