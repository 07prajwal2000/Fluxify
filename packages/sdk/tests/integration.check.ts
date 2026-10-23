// Type tests for `integration()` (I5): compiled by `bun run typecheck`, never run.
import { block, param } from "../blocks.js";
import { generateText } from "ai";
import type { AiAdapter, DatabaseAdapter, KvAdapter } from "../integrations.js";
import { integration } from "../integrations.js";
import type { IntegrationClient } from "../src/context.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
	? true
	: false;
const assert = <T extends true>() => {};

const kvClient: KvAdapter = {
	get: async () => null,
	set: async () => {},
	setex: async () => {},
	delete: async () => {},
};
const db = {} as DatabaseAdapter;
const common = { label: "X", icon: "./x.svg", variant: "X" };

function contractChecks() {
	const _kv = integration({
		...common,
		name: "acme/t/kv",
		group: "kv",
		config: { url: param.string({ required: true }), token: param.secret({ required: true }) },
		connect: async (config, ctx) => {
			assert<Equal<typeof config, { url: string; token: string }>>();
			ctx.getConfig(config.token);
			return kvClient;
		},
	});

	// @ts-expect-error a kv variant's client must be a whole KvAdapter
	integration({ ...common, name: "acme/t/kv", group: "kv", config: {}, connect: async () => ({ get: async () => null }) });

	// @ts-expect-error an ai variant must hand out a languageModel
	integration({ ...common, name: "acme/t/ai", group: "ai", config: {}, connect: () => ({ embeddingModel: () => null as never }) });

	// @ts-expect-error a database variant must say its condition editor and dbType
	integration({ ...common, name: "acme/t/db", group: "database", config: {}, connect: () => db, adapter: () => db });

	// @ts-expect-error a database variant must build each request's adapter
	integration({ ...common, name: "acme/t/db", group: "database", extras: { conditionEditor: "sql", dbType: "acme" }, config: {}, connect: () => db });

	const _db = integration({
		...common,
		name: "acme/t/db",
		group: "database",
		extras: { conditionEditor: "sql", dbType: "acme" },
		config: {},
		// the pool is anything; each request gets its own adapter on it
		connect: () => ({ pool: true as const }),
		adapter: (pool) => {
			assert<Equal<typeof pool, { pool: true }>>();
			return db;
		},
		test: (client) => {
			assert<Equal<typeof client, DatabaseAdapter>>();
		},
	});
	assert<Equal<IntegrationClient<typeof _db>, DatabaseAdapter>>();

	// a plugin's own group hands out anything
	const _crm = integration({
		...common,
		name: "acme/t/hub",
		group: "crm",
		config: { region: param.select({ options: ["eu", "us"], required: true }) },
		connect: async (config) => ({ region: config.region, contacts: async () => [] as string[] }),
	});
	void [_kv, _db, _crm];
	return _crm;
}

const hub = contractChecks();

// a same-plugin block gets the client type from `typeof` the definition
block({
	name: "acme/t/list",
	label: "List",
	permissions: { integrations: ["acme/crm"] },
	params: { conn: param.integration({ kind: "acme/crm" }) },
	async run({ params, ctx }) {
		const client = await ctx.integrations.get<typeof hub>(params.conn);
		assert<Equal<typeof client, { region: "eu" | "us"; contacts: () => Promise<string[]> }>>();
		assert<Equal<IntegrationClient<typeof hub>, typeof client>>();
		// the I4 forms keep working
		assert<Equal<Awaited<ReturnType<typeof ctx.integrations.get<"kv">>>, KvAdapter>>();
		assert<Equal<Awaited<ReturnType<typeof ctx.integrations.get<{ n: 1 }>>>, { n: 1 }>>();
		// the AI SDK takes the model as it is
		const ai = await ctx.integrations.get<"ai">(params.conn);
		assert<Equal<typeof ai, AiAdapter>>();
		await generateText({ model: ai.languageModel(), prompt: "hi" });
		await generateText({ model: ai.languageModel("gpt-5-mini"), prompt: "hi" });
		return { output: await client.contacts() };
	},
});
