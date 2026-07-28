import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { BaseAgentWrapper } from "../base";

export class OpenAIAgentWrapper extends BaseAgentWrapper {
	private baseUrl?: string;

	constructor(
		modelName: string,
		apiKey?: string,
		additionalHeaders?: Record<string, string>,
		baseUrl?: string,
		maxToolIterations?: number,
	) {
		super(modelName, apiKey, additionalHeaders, baseUrl, maxToolIterations);
		this.baseUrl = baseUrl;
	}

	protected getModel(): BaseChatModel {
		return new ChatOpenAI({
			model: this.modelName,
			// Must be `apiKey`. ChatOpenAI reads only `fields.apiKey`,
			// `configuration.apiKey`, or $OPENAI_API_KEY — `openAIApiKey` is a dead
			// alias on chat models (it still works on OpenAI() / OpenAIEmbeddings),
			// so passing it silently dropped the key and every request failed with
			// "Missing credentials".
			// The fallback covers keyless local servers (Ollama, LM Studio, vLLM),
			// which reject nothing but still need the SDK to construct.
			apiKey: this.apiKey || (this.baseUrl ? "not-required" : undefined),
			configuration: {
				baseURL: this.baseUrl,
				defaultHeaders: this.additionalHeaders,
			},
		});
	}

	// A custom baseUrl means an OpenAI-compatible server, not OpenAI. Most of them
	// (Ollama, LM Studio, llama.cpp) reject the `json_schema` response format, so
	// go straight to the prompt-based fallback instead of burning retries on it.
	protected supportsStructuredOutput(): boolean {
		return !this.baseUrl;
	}
}
