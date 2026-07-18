import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogle } from "@langchain/google";
import { BaseAgentWrapper } from "../base";

export class GoogleAgentWrapper extends BaseAgentWrapper {
	protected getModel(): BaseChatModel {
		return new ChatGoogle({
			model: this.modelName,
			apiKey: this.apiKey,
		});
	}
}
