import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const PROVIDERS = ["openai", "anthropic", "google", "mistral", "openai-compatible"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * The model the agent runs on, from AGENT_PROVIDER, AGENT_MODEL, AGENT_API_KEY and
 * AGENT_BASE_URL (required for openai-compatible: Ollama, DeepSeek, OpenRouter, …).
 * Throws a readable error on a bad setting.
 */
export function modelFromEnv(
	env: Record<string, string | undefined>,
): Exclude<LanguageModel, string> {
	const provider = env.AGENT_PROVIDER as Provider;
	const model = env.AGENT_MODEL;
	const apiKey = env.AGENT_API_KEY;
	const baseURL = env.AGENT_BASE_URL || undefined;
	if (!PROVIDERS.includes(provider))
		throw new Error(`AGENT_PROVIDER must be one of: ${PROVIDERS.join(", ")}`);
	if (!model) throw new Error("AGENT_MODEL is required");
	switch (provider) {
		case "openai":
			return createOpenAI({ apiKey, baseURL })(model);
		case "anthropic":
			return createAnthropic({ apiKey, baseURL })(model);
		case "google":
			return createGoogle({ apiKey, baseURL })(model);
		case "mistral":
			return createMistral({ apiKey, baseURL })(model);
		case "openai-compatible":
			if (!baseURL) throw new Error("AGENT_BASE_URL is required for openai-compatible");
			return createOpenAICompatible({ name: "openai-compatible", apiKey, baseURL })(model);
	}
}
