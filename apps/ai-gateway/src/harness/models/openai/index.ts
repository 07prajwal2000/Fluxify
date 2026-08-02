import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import {
	BaseAgentWrapper,
	HARNESS_MAX_TOKENS,
	HARNESS_TEMPERATURE,
} from "../base";

/** Reasoning models reject any temperature but the default and 400 the request. */
const FIXED_TEMPERATURE_MODEL = /(^|\/)(o\d|gpt-5)/i;

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

	protected createModel(): BaseChatModel {
		return new ChatOpenAI({
			model: this.modelName,
			// Reasoning models take `maxCompletionTokens` (the cap covers reasoning
			// tokens too) and reject `maxTokens`; everything else is the reverse.
			...(FIXED_TEMPERATURE_MODEL.test(this.modelName)
				? { maxCompletionTokens: HARNESS_MAX_TOKENS }
				: {
						temperature: HARNESS_TEMPERATURE,
						maxTokens: HARNESS_MAX_TOKENS,
					}),
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

	// `json_object` is the lowest common denominator across the OpenAI-compatible
	// world (DeepSeek, Groq, LM Studio, vLLM, LiteLLM all honour it) — unlike
	// `json_schema`, which is what supportsStructuredOutput() opts out of above.
	protected jsonModeOptions() {
		return { response_format: { type: "json_object" as const } };
	}
}
