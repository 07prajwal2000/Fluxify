import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatMistralAI } from "@langchain/mistralai";
import { BaseAgentWrapper } from "../base";

export class MistralAgentWrapper extends BaseAgentWrapper {
	protected getModel(): BaseChatModel {
		return new ChatMistralAI({
			model: this.modelName,
			apiKey: this.apiKey,
		});
	}
}
