import { createHash } from "node:crypto";
import {
	AnthropicIntegration,
	type BaseAiIntegration,
	GeminiIntegration,
	MistralIntegration,
	type ModelInfo,
	OpenAICompatibleIntegration,
	OpenAIIntegration,
} from "@fluxify/adapters";
import type { z } from "zod";
import { decodeAppConfig } from "../../../../modules/integrationOps/appConfig";
import { ADMIN_CONNECTION_ENV } from "../adminEnv";
import { getAppConfigKeysFromData } from "../create/service";
import type { requestBodySchema, responseSchema } from "./dto";

const PROVIDERS: Record<z.infer<typeof requestBodySchema>["variant"], typeof BaseAiIntegration> = {
	OpenAI: OpenAIIntegration,
	Anthropic: AnthropicIntegration,
	Gemini: GeminiIntegration,
	Mistral: MistralIntegration,
	"OpenAI Compatible": OpenAICompatibleIntegration,
};

export const MODELS_CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHED = 200;
// ponytail: per-process; a second server instance lists once more. Share it (KV) if that ever hurts.
const cache = new Map<string, { at: number; models: ModelInfo[] }>();

/**
 * The models a provider offers for a config typed in the form, saved or not
 * (#698). Always answers: a provider that refuses, or a missing key, is an
 * `error` the picker shows, never a 500, because the model field stays free text.
 */
export default async function handleRequest(
	projectId: string,
	body: z.infer<typeof requestBodySchema>,
	now = Date.now(),
): Promise<z.infer<typeof responseSchema>> {
	const { variant, config, refresh } = body;
	const needsBaseUrl = variant === "OpenAI Compatible";
	if (needsBaseUrl && !config.baseUrl)
		return { models: [], error: "Add a Base URL to load models" };
	if (!needsBaseUrl && !config.apiKey)
		return { models: [], error: "Add an API key to load models" };
	try {
		const appConfigs = await decodeAppConfig(
			getAppConfigKeysFromData(config),
			projectId,
			ADMIN_CONNECTION_ENV,
		);
		const provider = PROVIDERS[variant];
		const resolved = provider.ExtractConnectionInfo(
			{ apiKey: "", ...config, model: String(config.model ?? "") },
			appConfigs,
		);
		// keyed on the resolved config, so a changed key or app config value is a different entry
		const key = createHash("sha256")
			.update(JSON.stringify([projectId, variant, resolved]))
			.digest("hex");
		const hit = cache.get(key);
		if (!refresh && hit && now - hit.at < MODELS_CACHE_TTL_MS)
			return { models: hit.models, cached: true };
		const models = await provider.ListModelInfo(resolved);
		cache.delete(key);
		cache.set(key, { at: now, models });
		if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
		return { models };
	} catch (error) {
		return {
			models: [],
			error: (error instanceof Error ? error.message : String(error)) || "Could not load models",
		};
	}
}

export const clearModelsCache = () => cache.clear();
