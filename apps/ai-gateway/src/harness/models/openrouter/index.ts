import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenRouter } from "@langchain/openrouter";
import { BaseAgentWrapper } from "../base";

export class OpenRouterAgentWrapper extends BaseAgentWrapper {
	protected getModel(): BaseChatModel {
		return new ChatOpenRouter({
			model: this.modelName,
			apiKey: this.apiKey,
			...(this.additionalHeaders
				? { modelKwargs: { extra_headers: this.additionalHeaders } }
				: {}),
		});
	}

	// OpenRouter relies on various underlying models, many of which don't support structured output reliably.
	// We use our fallback for better predictability.
	protected supportsStructuredOutput(): boolean {
		return false;
	}
}
