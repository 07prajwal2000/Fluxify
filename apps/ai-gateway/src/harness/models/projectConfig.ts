import { aiIntegrationsCache, aiVariantSchema, getProjectSetting } from "@fluxify/server";
import type { AgentFactoryOptions, AgentProvider } from "./factory";

/** Maps a stored AI integration variant to the harness agent provider. */
const VARIANT_TO_PROVIDER: Record<string, AgentProvider> = {
	[aiVariantSchema.enum.Anthropic]: "anthropic",
	[aiVariantSchema.enum.Gemini]: "google",
	[aiVariantSchema.enum.OpenAI]: "openai",
	[aiVariantSchema.enum.Mistral]: "mistral",
	[aiVariantSchema.enum["OpenAI Compatible"]]: "openai",
};

/** Maps a cached AI integration to harness agent options. Throws if missing/unsupported. */
export function resolveAgentOptionsFromIntegrationId(
	integrationId: string,
): AgentFactoryOptions {
	const integration = aiIntegrationsCache[integrationId];

	if (!integration) {
		throw new Error("Selected AI integration not found");
	}

	const provider = VARIANT_TO_PROVIDER[integration.variant];
	if (!provider) {
		throw new Error(`Unsupported AI variant for harness: ${integration.variant}`);
	}

	return {
		provider,
		modelName: integration.model,
		apiKey: integration.apiKey,
		baseUrl: integration.baseUrl,
	};
}

/**
 * Resolves the harness agent config from the user-configured AI integration for
 * a project. Keys never leave the server config — nothing is read from env or
 * hardcoded. Throws if the project has no AI integration set.
 */
export async function resolveAgentOptionsFromProjectId(
	projectId: string,
): Promise<AgentFactoryOptions> {
	const integrationId = await getProjectSetting(
		projectId,
		"settings.ai.agentConnectionId",
	);
	return resolveAgentOptionsFromIntegrationId(integrationId);
}
