import { useMemo } from "react";
import { integrationsQuery } from "@/query/integrationsQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import type { AiModel } from "./ModelSelect";

export function useAiModels(projectId: string) {
	const { data: integrationsData, isLoading: isLoadingInts } = integrationsQuery.getBasicList.useQuery(projectId, true);
	const { data: settingsData, isLoading: isLoadingSettings } = projectSettingsKeysQuery.getAll.useQuery(projectId);

	return useMemo(() => {
		if (isLoadingInts || isLoadingSettings) {
			return { models: [], defaultModelId: "", isBlocked: false, isLoading: true };
		}
		
		const allIntegrations = integrationsData ?? [];
		
		const aiIntegrations = allIntegrations.filter((i: any) => 
			i.group === "ai"
		);
		
		const availableModels: AiModel[] = aiIntegrations.map((i: any) => ({
			id: i.id,
			name: i.name,
			variant: i.variant,
		}));

		const agentConnectionId = settingsData?.["settings.ai.agentConnectionId"];
		
		let defId = "";
		let blocked = false;

		if (agentConnectionId) {
			const model = availableModels.find((m) => m.id === agentConnectionId);
			if (model) {
				model.isFallback = true;
				defId = agentConnectionId;
			} else {
				const fallbackInt = allIntegrations.find((i: any) => i.id === agentConnectionId);
				if (fallbackInt) {
					availableModels.push({
						id: agentConnectionId,
						name: fallbackInt.name || "Project Default",
						variant: fallbackInt.variant,
						isFallback: true
					});
					defId = agentConnectionId;
				}
			}
		}

		if (availableModels.length === 0) {
			blocked = true;
		}

		return { models: availableModels, defaultModelId: defId, isBlocked: blocked, isLoading: false };
	}, [integrationsData, settingsData, isLoadingInts, isLoadingSettings]);
}
