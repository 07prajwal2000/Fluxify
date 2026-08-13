import { useCallback } from "react";
import { IntegrationSelector, Spinner, toast } from "@fluxify/components";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { integrationService } from "@/services/integrations";
import { withBasePath } from "@/constants/routes";
import { showErrorNotification } from "@/lib/errorNotifier";

export function AiConnectionsSettings({ projectId }: { projectId: string }) {
	const { data, isLoading } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);

	const settings = (data ?? {}) as Record<string, string>;

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">AI Connections</h1>
				<p className="text-sm text-muted">Manage your AI connections.</p>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : (
				<AiSelector
					projectId={projectId}
					label="Agent LLM Connection"
					description="Select the AI integration used by the built-in agents and workflow AI nodes."
					selectedId={settings["settings.ai.agentConnectionId"] || ""}
					onSelect={(value) =>
						upsert.mutate(
							{ key: "settings.ai.agentConnectionId", value } as RequestBodySchema,
							{
								onSuccess: () => toast.success("AI connection saved"),
								onError: (e) => showErrorNotification(e as Error),
							},
						)
					}
				/>
			)}
		</div>
	);
}

function AiSelector({
	projectId,
	label,
	description,
	selectedId,
	onSelect,
}: {
	projectId: string;
	label: string;
	description: string;
	selectedId: string;
	onSelect: (value: string) => void;
}) {
	const loadIntegrations = useCallback(
		async () =>
			(await integrationService.getAll(projectId, "ai")) ?? [],
		[projectId],
	);

	return (
		<IntegrationSelector
			label={label}
			description={description}
			group="ai"
			selectedId={selectedId}
			loadIntegrations={loadIntegrations}
			onSelect={onSelect}
			onTestConnection={(id) =>
				integrationService
					.testExistingConnection(projectId, id)
					.then(() => {})
			}
			openInNewTabUrl={withBasePath(
				`/${projectId}/integrations?group=ai${selectedId ? `&open=${encodeURIComponent(selectedId)}` : ""}`,
			)}
			createIntegrationUrl={withBasePath(`/${projectId}/integrations?group=ai`)}
		/>
	);
}
