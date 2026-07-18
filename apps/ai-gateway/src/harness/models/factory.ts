import { BaseAgentWrapper } from "./base";
import { OpenAIAgentWrapper } from "./openai/index";
import { AnthropicAgentWrapper } from "./anthropic/index";
import { GoogleAgentWrapper } from "./google/index";
import { MistralAgentWrapper } from "./mistral/index";
import { OpenRouterAgentWrapper } from "./openrouter/index";
import { OllamaAgentWrapper } from "./ollama/index";

export type AgentProvider =
	| "openai"
	| "anthropic"
	| "google"
	| "mistral"
	| "openrouter"
	| "ollama";

export interface AgentFactoryOptions {
	provider: AgentProvider;
	modelName: string;
	apiKey?: string;
	additionalHeaders?: Record<string, string>;
	baseUrl?: string;
}

export class AgentFactory {
	private options: AgentFactoryOptions;

	constructor(options: AgentFactoryOptions) {
		this.options = options;
	}

	public createAgent(): BaseAgentWrapper {
		const { provider, modelName, apiKey, additionalHeaders, baseUrl } =
			this.options;

		switch (provider) {
			case "openai":
				return new OpenAIAgentWrapper(
					modelName,
					apiKey,
					additionalHeaders,
					baseUrl,
				);
			case "anthropic":
				return new AnthropicAgentWrapper(
					modelName,
					apiKey,
					additionalHeaders,
					baseUrl,
				);
			case "google":
				return new GoogleAgentWrapper(modelName, apiKey, additionalHeaders);
			case "mistral":
				return new MistralAgentWrapper(modelName, apiKey, additionalHeaders);
			case "openrouter":
				return new OpenRouterAgentWrapper(modelName, apiKey, additionalHeaders);
			case "ollama":
				return new OllamaAgentWrapper(modelName, baseUrl, additionalHeaders);
			default:
				throw new Error(`Unsupported agent provider: ${provider}`);
		}
	}
}
