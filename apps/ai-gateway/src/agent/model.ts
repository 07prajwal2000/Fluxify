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
 * Throws a readable error on a bad setting. `prefix` reads another set, e.g. AGENT_JUDGE_*.
 */
export function modelFromEnv(
	env: Record<string, string | undefined>,
	prefix = "AGENT",
): Exclude<LanguageModel, string> {
	const provider = env[`${prefix}_PROVIDER`] as Provider;
	const model = env[`${prefix}_MODEL`];
	const apiKey = env[`${prefix}_API_KEY`];
	const baseURL = env[`${prefix}_BASE_URL`] || undefined;
	if (!PROVIDERS.includes(provider))
		throw new Error(`${prefix}_PROVIDER must be one of: ${PROVIDERS.join(", ")}`);
	if (!model) throw new Error(`${prefix}_MODEL is required`);
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
			if (!baseURL) throw new Error(`${prefix}_BASE_URL is required for openai-compatible`);
			return createOpenAICompatible({ name: "openai-compatible", apiKey, baseURL })(model);
	}
}
