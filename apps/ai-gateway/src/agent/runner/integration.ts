import { aiIntegrationsCache, getProjectSetting, ownsIntegration } from "@fluxify/server";
import { integrationSupportsThinking } from "../model";

/** The AI integration a project's agent runs on (#661); undefined when none is set or it is not the project's. */
export async function agentIntegration(projectId: string) {
	const id = await getProjectSetting(projectId, "settings.ai.agentConnectionId");
	const integration = aiIntegrationsCache[id];
	return integration && ownsIntegration(integration, projectId) ? integration : undefined;
}

/** Whether the project's agent model takes a thinking setting (false with no model set). */
export async function projectSupportsThinking(projectId: string) {
	const integration = await agentIntegration(projectId).catch(() => undefined);
	return integration ? integrationSupportsThinking(integration) : false;
}
