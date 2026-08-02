import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogle } from "@langchain/google";
import {
	BaseAgentWrapper,
	HARNESS_MAX_TOKENS,
	HARNESS_TEMPERATURE,
} from "../base";

export class GoogleAgentWrapper extends BaseAgentWrapper {
	protected createModel(): BaseChatModel {
		return new ChatGoogle({
			model: this.modelName,
			apiKey: this.apiKey,
			temperature: HARNESS_TEMPERATURE,
			maxOutputTokens: HARNESS_MAX_TOKENS,
		});
	}
}
