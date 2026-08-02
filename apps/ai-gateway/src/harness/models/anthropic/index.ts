import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage } from "@langchain/core/messages";
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

	/**
	 * Marks the system block as a cache breakpoint, so the tools + system prefix
	 * ahead of it is written once and read back at ~10% of the input price on
	 * every later call (each tool-loop iteration re-sends the whole prompt).
	 *
	 * The breakpoint deliberately sits on the system block and nowhere else: the
	 * message list is rewritten by `compactToolHistory` as the loop runs, so a
	 * breakpoint further down would be a paid cache write that never gets read.
	 * Prompts under Anthropic's 1024-token minimum simply aren't cached — no error.
	 */
	protected buildSystemMessage(text: string): SystemMessage {
		return new SystemMessage({
			content: [
				{ type: "text", text, cache_control: { type: "ephemeral" } },
			],
		});
	}

	protected createModel(): BaseChatModel {
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
