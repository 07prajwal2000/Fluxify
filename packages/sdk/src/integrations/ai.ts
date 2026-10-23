import type { EmbeddingModelV4, LanguageModelV4 } from "@ai-sdk/provider";

/**
 * Adapter interface for AI providers (OpenAI, Anthropic, Gemini, Mistral, etc.).
 *
 * Fluxify owns the connection (provider, key, base URL, pooling, tracing); the
 * models are the AI SDK's own, unwrapped. Pass them to `generateText`,
 * `streamText`, `generateObject` or an `Agent` from `ai`.
 */
export interface AiAdapter {
	/** A chat model; no id is the integration's configured default model. */
	languageModel(modelId?: string): LanguageModelV4;
	/** An embedding model, where the provider has them. */
	embeddingModel?(modelId?: string): EmbeddingModelV4;
}

export type IAiAdapter = AiAdapter;

/** Inspect/metadata shape for AI integrations (e.g. available models). */
export type AiInspectResult = {
	models: string[];
};

export type AiMetadata = AiInspectResult;
