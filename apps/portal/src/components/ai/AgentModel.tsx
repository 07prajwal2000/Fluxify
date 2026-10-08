import { Link } from "@tanstack/react-router";
import { TbCpu } from "react-icons/tb";
import { integrationsQuery } from "@/query/integrationsQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";

/** The integration the agent runs on: the project's AI configuration (`settings.ai.agentConnectionId`). */
export function useAgentModel(projectId: string) {
	const settings = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const id = (settings.data as Record<string, string> | undefined)?.[
		"settings.ai.agentConnectionId"
	];
	const integration = integrationsQuery.getById.useQuery(projectId, id ?? "");
	const config = integration.data?.config as { model?: string } | undefined;
	return {
		isLoading: settings.isLoading || (Boolean(id) && integration.isLoading),
		missing: !settings.isLoading && (!id || integration.isError),
		label: integration.data ? config?.model || integration.data.name : null,
	};
}

/** Read-only model name; the model is picked in project settings. */
export function AgentModelLabel({ projectId }: { projectId: string }) {
	const { label } = useAgentModel(projectId);
	return (
		<Link
			to="/$projectId/settings"
			params={{ projectId }}
			search={{ tab: "ai-connections" }}
			className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface hover:text-foreground"
			title="Change the model in project settings"
		>
			<TbCpu size={14} className="shrink-0" />
			<span className="truncate">{label ?? "No model set"}</span>
		</Link>
	);
}
