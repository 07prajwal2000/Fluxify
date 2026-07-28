import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogle } from "@langchain/google";
import { BaseAgentWrapper, HARNESS_TEMPERATURE } from "../base";

export class GoogleAgentWrapper extends BaseAgentWrapper {
	protected getModel(): BaseChatModel {
		return new ChatGoogle({
			model: this.modelName,
			apiKey: this.apiKey,
			temperature: HARNESS_TEMPERATURE,
		});
	}
}
