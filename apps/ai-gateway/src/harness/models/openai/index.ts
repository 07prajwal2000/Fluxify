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
			openAIApiKey: this.apiKey,
			configuration: {
				baseURL: this.baseUrl,
				defaultHeaders: this.additionalHeaders,
			},
		});
	}
}
