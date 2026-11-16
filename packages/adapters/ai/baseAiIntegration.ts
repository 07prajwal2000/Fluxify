import type { EmbeddingModelV4, LanguageModelV4 } from "@ai-sdk/provider";
import { type AiAdapter, resolveCustomHeaders } from "@fluxify/sdk/integrations";

export type { AiAdapter };

/** a stored AI integration, `cfg:` references expanded */
export type AiConfig = {
	apiKey: string;
	model: string;
	baseUrl?: string;
	/** extra request headers, `cfg:` references expanded */
	headers?: Record<string, string>;
	/** OpenAI Compatible only: extra JSON fields for the request body (#1068), `cfg:` references expanded */
	extraBody?: Record<string, unknown>;
};

type Fetch = typeof fetch;

/** an AI SDK provider instance (`createOpenAI(...)` and friends) */
type Provider = {
	languageModel(modelId: string): LanguageModelV4;
	embeddingModel(modelId: string): EmbeddingModelV4;
};

/** one model a provider lists; everything but the id is only there when the provider says it (#698) */
export type ModelInfo = {
	id: string;
	name?: string;
	/** tokens */
	contextLength?: number;
	/** USD per million tokens */
	pricing?: { input: number; output: number };
};

/** how one provider connects, and how it lists its models (the cheapest real call) */
export type AiProviderSpec = {
	name: string;
	/** `require`s its SDK here, not at the top, so a project without this provider never loads it (#944) */
	create(config: AiConfig, fetch?: Fetch): Provider;
	models: {
		url(config: AiConfig): string;
		headers(config: AiConfig): Record<string, string>;
		ids(body: any): string[];
		/** names, limits, prices; without it a model is just its id */
		info?(body: any): ModelInfo[];
	};
};

/** `Authorization: Bearer`, `{ data: [{ id }] }`: OpenAI, Mistral and most compatible servers */
export const openAiModels = (defaultBaseUrl: string): AiProviderSpec["models"] => ({
	url: (c) => `${(c.baseUrl || defaultBaseUrl).replace(/\/+$/, "")}/models`,
	headers: (c): Record<string, string> => (c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}),
	ids: (body) => body.data.map((m: { id: string }) => m.id),
	// OpenRouter (and some gateways) add name, context_length and per-token prices to each entry
	info: (body) => body.data.map(openAiModelInfo),
});

const perMillion = (perToken: unknown) => {
	const n = Number(perToken) * 1_000_000;
	return Number.isFinite(n) ? n : undefined;
};

const openAiModelInfo = (m: any): ModelInfo => {
	const input = perMillion(m.pricing?.prompt);
	const output = perMillion(m.pricing?.completion);
	return {
		id: m.id,
		...(typeof m.name === "string" && m.name !== m.id && { name: m.name }),
		...(typeof m.context_length === "number" && { contextLength: m.context_length }),
		...(input !== undefined && output !== undefined && { pricing: { input, output } }),
	};
};

const fromAppConfig = (value: string, appConfigs: Map<string, string>, what: string) => {
	if (!value?.startsWith("cfg:")) return value;
	const resolved = appConfigs.get(value.slice(4));
	if (!resolved) throw new Error(`${what} not found`);
	return resolved;
};

/** a JSON value with every `cfg:` string expanded, at any depth; a missing key throws */
const expandJson = (value: unknown, appConfigs: Map<string, string>): unknown => {
	if (typeof value === "string") return fromAppConfig(value, appConfigs, "Extra body value");
	if (Array.isArray(value)) return value.map((v) => expandJson(v, appConfigs));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, expandJson(v, appConfigs)]),
		);
	return value;
};

/**
 * A provider connection: the AI SDK provider is built once per integration
 * (pooled by config), and hands out the SDK's own models, unwrapped.
 */
export class BaseAiIntegration implements AiAdapter {
	static variant: string;
	static provider: AiProviderSpec;
	private readonly client: Provider;

	constructor(
		private readonly config: AiConfig,
		fetch?: Fetch,
	) {
		this.client = (new.target as typeof BaseAiIntegration).provider.create(config, fetch);
	}

	languageModel(modelId = this.config.model) {
		return this.client.languageModel(modelId);
	}

	embeddingModel(modelId?: string) {
		if (!modelId) throw new Error("embeddingModel needs a model id");
		return this.client.embeddingModel(modelId);
	}

	/** a new object: the stored row keeps its `cfg:` references (see `expandStoredConfig`) */
	static ExtractConnectionInfo(config: AiConfig, appConfigs: Map<string, string>): AiConfig {
		return {
			...config,
			apiKey: fromAppConfig(config.apiKey, appConfigs, "API key"),
			...(config.baseUrl !== undefined && {
				baseUrl: fromAppConfig(config.baseUrl, appConfigs, "Base URL"),
			}),
			...(config.headers && { headers: resolveCustomHeaders(config.headers, appConfigs) }),
			...(config.extraBody && {
				extraBody: expandJson(config.extraBody, appConfigs) as Record<string, unknown>,
			}),
		};
	}

	/** the provider's model ids; a refusal throws with the provider's status and message */
	static async ListModels(config: AiConfig, fetch: Fetch = globalThis.fetch) {
		return (await this.ListModelInfo(config, fetch)).map((m) => m.id);
	}

	/** the provider's models, with whatever else it reports about each; a refusal throws with the provider's status and message */
	static async ListModelInfo(
		config: AiConfig,
		fetch: Fetch = globalThis.fetch,
	): Promise<ModelInfo[]> {
		const { models } = this.provider;
		const res = await fetch(models.url(config), {
			headers: { ...models.headers(config), ...config.headers },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 500)}`);
		const body = await res.json();
		return models.info ? models.info(body) : models.ids(body).map((id) => ({ id }));
	}

	static async TestConnection(config: AiConfig, appConfigs: Map<string, string>) {
		await this.ListModels(this.ExtractConnectionInfo(config, appConfigs));
		return true;
	}
}
