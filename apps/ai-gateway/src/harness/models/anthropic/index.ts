import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import {
	BaseAgentWrapper,
	HARNESS_MAX_TOKENS,
	HARNESS_TEMPERATURE,
} from "../base";

export class AnthropicAgentWrapper extends BaseAgentWrapper {
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
		return new ChatAnthropic({
			model: this.modelName,
			// `apiKey` is the canonical field; `anthropicApiKey` is a legacy alias.
			apiKey: this.apiKey,
			temperature: HARNESS_TEMPERATURE,
			maxTokens: HARNESS_MAX_TOKENS,
			anthropicApiUrl: this.baseUrl,
			clientOptions: {
				defaultHeaders: this.additionalHeaders,
			},
		});
	}
}
