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

/**
 * Creates an AI model instance based on the project configuration.
 *
 * @param projectId - The ID of the project to retrieve configuration for
 * @returns An instance of the configured AI model
 */
export async function createAIModelInstanceFromProjectId(projectId: string) {
	const integrationId = await getProjectSetting(
		projectId,
		"settings.ai.agentConnectionId",
	);
	const integration = aiIntegrationsCache[integrationId];
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
		const openai = createOpenAI({ apiKey: config.apiKey });
		return openai(config.model);
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
