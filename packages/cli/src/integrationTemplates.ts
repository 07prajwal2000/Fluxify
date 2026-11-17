// What `integrations create` writes: one integration per file, its client
// stubbed for the group's contract (or free-form for a group of the plugin's own).
import type { BUILT_IN_INTEGRATION_GROUPS } from "@fluxify/sdk/integrations";

const todo = `throw new Error("not implemented")`;

/** the group's contract type and a stub of each of its methods */
const CONTRACTS: Record<
	(typeof BUILT_IN_INTEGRATION_GROUPS)[number],
	{ type: string; methods: string[] }
> = {
	database: {
		type: "DatabaseAdapter",
		methods: [
			"getAll",
			"getPage",
			"getSingle",
			"count",
			"insert",
			"insertBulk",
			"update",
			"raw",
			"delete",
			"setMode",
			"startTransaction",
			"commitTransaction",
			"rollbackTransaction",
		],
	},
	kv: { type: "KvAdapter", methods: ["get", "set", "setex", "delete"] },
	queue: { type: "QueueProducer", methods: ["send", "client", "close"] },
	ai: { type: "AiAdapter", methods: [] },
	observability: { type: "ObservabilityAdapter", methods: ["logInfo", "logWarn", "logError"] },
	baas: { type: "BaasAdapter", methods: ["client"] },
	mcp: { type: "McpAdapter", methods: ["listTools", "callTool", "close"] },
	storage: { type: "ObjectStorageAdapter", methods: ["put", "get", "head", "list", "delete"] },
};

const SYNC = new Set(["logInfo", "logWarn", "logError", "client"]);

const label = (name: string) => name.split("/").at(-1)!;

const stubsOf = (contract: { methods: string[] }, indent: string) =>
	contract.methods
		.map((m) => `${indent}${SYNC.has(m) ? "" : "async "}${m}() {\n${indent}\t${todo};\n${indent}},`)
		.join("\n");

function clientCode(group: string) {
	const contract = CONTRACTS[group as keyof typeof CONTRACTS];
	if (!contract && group.includes("/"))
		return `// call your service with \`token\` here, and hand out the client ${group}'s blocks expect:
		// when its package declares that client in PluginGroups, anything else is a type error
		void token;
		return {};`;
	if (!contract)
		return `// your group: hand out whatever your blocks need, typed for them by \`typeof\` this integration
		return {
			async whoami() {
				return { region: config.region, tokenLength: token.length };
			},
		};`;
	if (group === "ai")
		return `// the AI SDK's own models, unwrapped: \`bun add @ai-sdk/openai-compatible\` (or your
		// provider's package); \`ai\` and \`@ai-sdk/provider\` are peer dependencies the worker provides
		const provider = createOpenAICompatible({
			name: "${group}",
			baseURL: \`https://\${config.region}.api.example.com/v1\`,
			apiKey: token,
		});
		const client: AiAdapter = {
			// no id: your default model
			languageModel: (modelId = "default-chat-model") => provider.languageModel(modelId),
			embeddingModel: (modelId = "default-embedding-model") => provider.embeddingModel(modelId),
		};
		return client;`;
	if (group === "database")
		return `// open your driver's pool with \`token\` here: one per integration, shared by every request
		return { token };`;
	return `// call your service with \`token\` here; every method of ${contract.type} is required
		void token;
		const client: ${contract.type} = {
${stubsOf(contract, "\t\t\t")}
		};
		return client;`;
}

/** a database's per-request adapter: its transaction lives here, never on the pool */
const adapterCode = () => `
	adapter(pool, config) {
		void pool;
		void config;
		const client: DatabaseAdapter = {
${stubsOf(CONTRACTS.database, "\t\t\t")}
		};
		return client;
	},`;

/** `dependency`: the npm package of the plugin whose group `group` is (#899) */
export const integrationTemplate = (type: string, group: string, dependency?: string) => {
	const contract = CONTRACTS[group as keyof typeof CONTRACTS];
	const imports = contract
		? `import type { ${contract.type} } from "@fluxify/sdk/integrations";\n`
		: dependency
			? `// types only: what ${dependency} says its group's client is (PluginGroups)\nimport type {} from "${dependency}";\n`
			: "";
	const about = contract
		? `a variant of the built-in ${group} group: the built-in ${group} blocks can use it`
		: dependency
			? `a variant of ${group}, the group of ${dependency}: its blocks and triggers can use it`
			: "a group of this plugin's own: Fluxify files it under the plugin's scope";
	const extras =
		group === "database"
			? `\t// a database also says how hand-written conditions are written\n\textras: { conditionEditor: "sql", dbType: "${label(type)}" },\n`
			: "";
	const provider =
		group === "ai" ? `import { createOpenAICompatible } from "@ai-sdk/openai-compatible";\n` : "";
	return `${provider}import { param } from "@fluxify/sdk/blocks";
import { integration } from "@fluxify/sdk/integrations";
${imports}
export default integration({
	name: "${type}",
	label: "${label(type)}",
	icon: "./icons/${label(type)}.svg",
	// ${about}
	group: "${group}",
	variant: "${label(type)}",
${extras}	config: {
		region: param.string({ label: "Region", required: true }),
		// the user picks an app config key; only the key is stored
		token: param.secret({ label: "API token", required: true }),
	},
	async connect(config, ctx) {
		// reads the value of the key the token field names; any other key throws
		const token = ctx.getConfig(config.token);
		${clientCode(group)}
	},${group === "database" ? adapterCode() : ""}
	async test() {
		return { success: true };
	},
});
`;
};

export const integrationTest = (file: string) => `import { expect, it } from "bun:test";
import { runIntegration } from "@fluxify/sdk/testing";
import hub from "./${file}";

it("connects with the token's app config value", async () => {
	const run = runIntegration(hub, {
		config: { region: "eu", token: "API_TOKEN" },
		appConfig: { API_TOKEN: "test-token" },
	});
	expect(await run.test()).toEqual({ success: true });
});
`;

/** a placeholder icon, so the first build passes */
export const PLACEHOLDER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>\n`;
