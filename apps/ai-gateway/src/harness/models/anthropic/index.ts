import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseAgentWrapper } from "../base";

export class AnthropicAgentWrapper extends BaseAgentWrapper {
	private baseUrl?: string;

	constructor(
		modelName: string,
		apiKey?: string,
		additionalHeaders?: Record<string, string>,
		baseUrl?: string,
	) {
		super(modelName, apiKey, additionalHeaders);
		this.baseUrl = baseUrl;
	}

	protected getModel(): BaseChatModel {
		return new ChatAnthropic({
			model: this.modelName,
			anthropicApiKey: this.apiKey,
			anthropicApiUrl: this.baseUrl,
			clientOptions: {
				defaultHeaders: this.additionalHeaders,
			},
		});
	}
}
