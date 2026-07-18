import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOllama } from "@langchain/ollama";
import { BaseAgentWrapper } from "../base";

export class OllamaAgentWrapper extends BaseAgentWrapper {
	private baseUrl?: string;

	constructor(
		modelName: string,
		baseUrl?: string,
		additionalHeaders?: Record<string, string>,
	) {
		super(modelName, undefined, additionalHeaders);
		this.baseUrl = baseUrl;
	}

	protected getModel(): BaseChatModel {
		return new ChatOllama({
			model: this.modelName,
			baseUrl: this.baseUrl,
		});
	}

	// Ollama models usually need fallback structured output
	protected supportsStructuredOutput(): boolean {
		return false;
	}
}
