import { useMemo } from "react";
import { integrationsQuery } from "@/query/integrationsQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import type { AiModel } from "./ModelSelect";

export function useAiModels(projectId: string) {
	const { data: integrationsData, isLoading: isLoadingInts } = integrationsQuery.getBasicList.useQuery(projectId);
	const { data: settingsData, isLoading: isLoadingSettings } = projectSettingsKeysQuery.getAll.useQuery(projectId);

	return useMemo(() => {
		if (isLoadingInts || isLoadingSettings) {
			return { models: [], defaultModelId: "", isBlocked: false, isLoading: true };
		}
		
		const allIntegrations = integrationsData ?? [];
		
		const aiIntegrations = allIntegrations.filter((i: any) => 
			i.group === "ai" && (i.config as Record<string, unknown>)?.useForHarness === true
		);
		
		let availableModels: AiModel[] = aiIntegrations.map((i: any) => ({
			id: i.id,
			name: i.name,
		}));

		let defId = availableModels[0]?.id || "";
		let blocked = false;

		if (availableModels.length === 0) {
			const agentConnectionId = settingsData?.["settings.ai.agentConnectionId"];
			if (agentConnectionId) {
				const fallbackInt = allIntegrations.find((i: any) => i.id === agentConnectionId);
				availableModels = [{
					id: agentConnectionId,
					name: fallbackInt?.name || "Project Default",
					isFallback: true
				}];
				defId = agentConnectionId;
			} else {
				blocked = true;
			}
		}

		return { models: availableModels, defaultModelId: defId, isBlocked: blocked, isLoading: false };
	}, [integrationsData, settingsData, isLoadingInts, isLoadingSettings]);
}
