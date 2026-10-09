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

/** A stored AI integration's variant → the provider it runs on. */
const VARIANT: Record<string, Provider> = {
	OpenAI: "openai",
	Anthropic: "anthropic",
	Gemini: "google",
	Mistral: "mistral",
	"OpenAI Compatible": "openai-compatible",
};

/** The model of a project's AI integration (`variant`, `model`, `apiKey`, `baseUrl` as loaded). */
export function modelFromIntegration(i: {
	variant: string;
	model?: string;
	apiKey?: string;
	baseUrl?: string;
}) {
	const provider = VARIANT[i.variant];
	if (!provider) throw new Error(`The agent does not support ${i.variant} integrations`);
	return modelFromEnv({
		AGENT_PROVIDER: provider,
		AGENT_MODEL: i.model,
		AGENT_API_KEY: i.apiKey || (i.baseUrl ? "not-required" : undefined),
		AGENT_BASE_URL: i.baseUrl,
	});
}

/** How hard the model thinks before it answers. `none` turns thinking off where the model allows it. */
export const EFFORTS = ["none", "low", "mid", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * Models known to take a thinking setting. The AI SDK has no runtime flag for it,
 * so this is our own list; anything else (including openai-compatible) is
 * unsupported and gets no thinking options.
 */
const THINKING: Partial<Record<Provider, RegExp>> = {
	// claude-3-7*, and claude-*-4 and newer (claude-sonnet-4-5, claude-opus-5-5, claude-4-opus)
	anthropic: /^claude-(?:3-7|(?:[a-z]+-)?(?:[4-9]|\d{2,})(?:-|$))/,
	// the o-series and gpt-5*; gpt-5-chat does not reason
	openai: /^(?:o[134]|gpt-5(?!-chat))/,
	google: /^gemini-(?:2\.5|3)/,
	mistral: /^magistral/,
};

export const supportsThinking = (provider: Provider, modelId: string) =>
	THINKING[provider]?.test(modelId) ?? false;

/** Tokens a thinking budget gets per effort (Anthropic, Google). */
const BUDGET = { none: 0, low: 2000, mid: 8000, high: 24000 } as const;

/** The lowest reasoning effort an OpenAI model allows for `none`: gpt-5.1 and newer take none, gpt-5 minimal, the o-series low. */
function openaiFloor(modelId: string) {
	const minor = /^gpt-5\.(\d+)/.exec(modelId);
	if (minor && Number(minor[1]) >= 1) return "none";
	return modelId.startsWith("gpt-5") ? "minimal" : "low";
}

/**
 * The `providerOptions` that set `effort` on a model, or undefined when the model is
 * not known to support thinking (nothing is sent then).
 */
export function thinkingOptions(
	provider: Provider,
	modelId: string,
	effort: Effort,
): Record<string, Record<string, unknown>> | undefined {
	if (!supportsThinking(provider, modelId)) return;
	switch (provider) {
		case "anthropic":
			return {
				anthropic: {
					thinking:
						effort === "none"
							? { type: "disabled" }
							: { type: "enabled", budgetTokens: BUDGET[effort] },
				},
			};
		case "openai":
			return {
				openai: {
					reasoningEffort:
						effort === "none" ? openaiFloor(modelId) : effort === "mid" ? "medium" : effort,
				},
			};
		case "google":
			return {
				google: {
					// gemini-2.5-pro cannot turn thinking off: its smallest budget is 128
					thinkingConfig: {
						thinkingBudget:
							effort === "none" && /^gemini-2\.5-pro/.test(modelId) ? 128 : BUDGET[effort],
					},
				},
			};
		case "mistral":
			// the API takes only none | high
			return { mistral: { reasoningEffort: effort === "none" ? "none" : "high" } };
	}
}

/** The provider a built model runs on, from its SDK id (`anthropic.messages` → `anthropic`). */
export const providerOf = (model: { provider: string }) => model.provider.split(".")[0] as Provider;

/** Whether a stored AI integration's model takes a thinking setting. */
export function integrationSupportsThinking(i: { variant: string; model?: string }) {
	const provider = VARIANT[i.variant];
	return Boolean(provider && i.model && supportsThinking(provider, i.model));
}

/** AGENT_EFFORT (none | low | mid | high); unset means the model's own default. Throws on anything else. */
export function effortFromEnv(env: Record<string, string | undefined>): Effort | undefined {
	const v = env.AGENT_EFFORT;
	if (!v) return undefined;
	if (!EFFORTS.includes(v as Effort))
		throw new Error(`AGENT_EFFORT must be one of: ${EFFORTS.join(", ")}`);
	return v as Effort;
}
