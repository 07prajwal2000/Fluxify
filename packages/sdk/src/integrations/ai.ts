/**
 * Adapter interface for AI providers (OpenAI, Anthropic, Gemini, Mistral, etc.).
 *
 * Provides a language model or agent instance for workflow blocks.
 */
export interface AiAdapter {
	/** Creates or returns the provider's underlying model client. */
	createModel(): unknown;
	/** Creates an agent with system prompt and tool definitions. */
	createAgent?(systemPrompt: string, tools: unknown[]): unknown;
}

export type IAiAdapter = AiAdapter;

/** Inspect/metadata shape for AI integrations (e.g. available models). */
export type AiInspectResult = {
	models: string[];
};

export type AiMetadata = AiInspectResult;
