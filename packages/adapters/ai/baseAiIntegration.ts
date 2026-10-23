import type { EmbeddingModelV4, LanguageModelV4 } from "@ai-sdk/provider";
import type { AiAdapter } from "@fluxify/sdk/integrations";

export type { AiAdapter };

/** a stored AI integration, `cfg:` references expanded */
export type AiConfig = { apiKey: string; model: string; baseUrl?: string };

type Fetch = typeof fetch;

/** an AI SDK provider instance (`createOpenAI(...)` and friends) */
type Provider = {
	languageModel(modelId: string): LanguageModelV4;
	embeddingModel(modelId: string): EmbeddingModelV4;
};

/** how one provider connects, and how it lists its models (the cheapest real call) */
export type AiProviderSpec = {
	name: string;
	create(config: AiConfig, fetch?: Fetch): Provider;
	models: {
		url(config: AiConfig): string;
		headers(config: AiConfig): Record<string, string>;
		ids(body: any): string[];
	};
};

/** `Authorization: Bearer`, `{ data: [{ id }] }`: OpenAI, Mistral and most compatible servers */
export const openAiModels = (defaultBaseUrl: string): AiProviderSpec["models"] => ({
	url: (c) => `${(c.baseUrl || defaultBaseUrl).replace(/\/+$/, "")}/models`,
	headers: (c) => ({ authorization: `Bearer ${c.apiKey}` }),
	ids: (body) => body.data.map((m: { id: string }) => m.id),
});

const fromAppConfig = (value: string, appConfigs: Map<string, string>, what: string) => {
	if (!value?.startsWith("cfg:")) return value;
	const resolved = appConfigs.get(value.slice(4));
	if (!resolved) throw new Error(`${what} not found`);
	return resolved;
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
		};
	}

	/** the provider's model ids; a refusal throws with the provider's status and message */
	static async ListModels(config: AiConfig, fetch: Fetch = globalThis.fetch) {
		const { models } = this.provider;
		const res = await fetch(models.url(config), {
			headers: models.headers(config),
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 500)}`);
		return models.ids(await res.json()) as string[];
	}

	static async TestConnection(config: AiConfig, appConfigs: Map<string, string>) {
		await this.ListModels(this.ExtractConnectionInfo(config, appConfigs));
		return true;
	}
}
