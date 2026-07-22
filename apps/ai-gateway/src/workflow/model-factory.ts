import {
	aiIntegrationsCache,
	aiVariantSchema,
	anthropicVariantConfigSchema,
	geminiVariantConfigSchema,
	getProjectSetting,
	mistralVariantConfigSchema,
	openAiCompatibleVariantConfigSchema,
} from "@fluxify/server";
import type z from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogle } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";

export async function createAIModelInstanceFromProjectId(projectId: string) {
	const integrationId = await getProjectSetting(
		projectId,
		"settings.ai.agentConnectionId",
	);
	const integration = aiIntegrationsCache[integrationId];

	if (!integration) {
		throw new Error("Integration not found to create AI Model instance");
	}
	if (integration.variant === aiVariantSchema.enum.Anthropic) {
		const config = integration as z.infer<typeof anthropicVariantConfigSchema>;
		const anthropic = createAnthropic({
			apiKey: config.apiKey,
		});
		return anthropic(config.model);
	} else if (
		integration.variant === aiVariantSchema.enum["OpenAI Compatible"]
	) {
		const config = integration as z.infer<
			typeof openAiCompatibleVariantConfigSchema
		>;
		const openaiCompatible = createOpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
		});
		return openaiCompatible(config.model);
	} else if (integration.variant === aiVariantSchema.enum.Gemini) {
		const config = integration as z.infer<typeof geminiVariantConfigSchema>;
		const google = createGoogle({ apiKey: config.apiKey });
		return google(config.model);
	} else if (integration.variant === aiVariantSchema.enum.Mistral) {
		const config = integration as z.infer<typeof mistralVariantConfigSchema>;
		const mistral = createMistral({ apiKey: config.apiKey });
		return mistral(config.model);
	}

	throw new Error("Unknown AI variant");
}
