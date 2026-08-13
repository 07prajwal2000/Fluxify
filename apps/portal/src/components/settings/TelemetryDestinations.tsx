import { useCallback } from "react";
import { IntegrationSelector, Spinner, toast } from "@fluxify/components";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { integrationService } from "@/services/integrations";
import { withBasePath } from "@/constants/routes";
import { showErrorNotification } from "@/lib/errorNotifier";

export const TELEMETRY_SIGNALS = [
	{
		key: "settings.telemetry.logsConnectionId",
		tag: "logs",
		label: "Logs destination",
		description:
			"Where log blocks and the JavaScript logger api send records. Falls back to the server console when unset.",
	},
	{
		key: "settings.telemetry.tracesConnectionId",
		tag: "traces",
		label: "Traces destination",
		description:
			"Where request traces are exported. With none set, traced routes record no spans at all.",
	},
	{
		key: "settings.telemetry.metricsConnectionId",
		tag: "metrics",
		label: "Metrics destination",
		description: "Where route request counts and durations are exported.",
	},
] as const;

export function TelemetryDestinations({ projectId }: { projectId: string }) {
	const { data, isLoading } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);

	const settings = (data ?? {}) as Record<string, string>;

	return (
		<div className="flex flex-col gap-1">
			{isLoading ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : (
				TELEMETRY_SIGNALS.map((signal) => (
					<TelemetrySelector
						key={signal.key}
						projectId={projectId}
						tag={signal.tag as "logs" | "traces" | "metrics"}
						label={signal.label}
						description={signal.description}
						// the legacy logs key is still read as a fallback server-side, so
						// an existing project shows its destination without a migration
						selectedId={
							settings[signal.key] ||
							(signal.tag === "logs"
								? settings["settings.ai.loggerConnectionId"] || ""
								: "")
						}
						onSelect={(value) =>
							upsert.mutate(
								{ key: signal.key, value } as RequestBodySchema,
								{
									onSuccess: () => toast.success("Destination saved"),
									onError: (e) => showErrorNotification(e as Error),
								},
							)
						}
					/>
				))
			)}
		</div>
	);
}

function TelemetrySelector({
	projectId,
	tag,
	label,
	description,
	selectedId,
	onSelect,
}: {
	projectId: string;
	tag: "logs" | "traces" | "metrics";
	label: string;
	description: string;
	selectedId: string;
	onSelect: (value: string) => void;
}) {
	const loadIntegrations = useCallback(
		async () =>
			(await integrationService.getAll(projectId, "observability", [tag])) ?? [],
		[projectId, tag],
	);

	return (
		<IntegrationSelector
			label={label}
			description={description}
			group="observability"
			selectedId={selectedId}
			loadIntegrations={loadIntegrations}
			onSelect={onSelect}
			onTestConnection={(id) =>
				integrationService
					.testExistingConnection(projectId, id, tag)
					.then(() => {})
			}
			openInNewTabUrl={withBasePath(
				`/${projectId}/integrations?group=observability${selectedId ? `&open=${encodeURIComponent(selectedId)}` : ""}`,
			)}
			createIntegrationUrl={withBasePath(
				`/${projectId}/integrations?group=observability`,
			)}
		/>
	);
}
