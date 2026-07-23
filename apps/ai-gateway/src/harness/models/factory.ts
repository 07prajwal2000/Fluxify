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
	maxToolIterations?: number;
}

export class AgentFactory {
	private options: AgentFactoryOptions;

	constructor(options: AgentFactoryOptions) {
		this.options = options;
	}

	public createAgent(): BaseAgentWrapper {
		const { provider, modelName, apiKey, additionalHeaders, baseUrl, maxToolIterations } =
			this.options;

		switch (provider) {
			case "openai":
				return new OpenAIAgentWrapper(
					modelName,
					apiKey,
					additionalHeaders,
					baseUrl,
					maxToolIterations,
				);
			case "anthropic":
				return new AnthropicAgentWrapper(
					modelName,
					apiKey,
					additionalHeaders,
					baseUrl,
					maxToolIterations,
				);
			case "google":
				return new GoogleAgentWrapper(modelName, apiKey, additionalHeaders, baseUrl, maxToolIterations);
			case "mistral":
				return new MistralAgentWrapper(modelName, apiKey, additionalHeaders, baseUrl, maxToolIterations);
			case "openrouter":
				return new OpenRouterAgentWrapper(modelName, apiKey, additionalHeaders, baseUrl, maxToolIterations);
			case "ollama":
				return new OllamaAgentWrapper(modelName, baseUrl, additionalHeaders, maxToolIterations);
			default:
				throw new Error(`Unsupported agent provider: ${provider}`);
		}
	}
}
