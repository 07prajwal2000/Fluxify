import { Checkbox, toast } from "@fluxify/components";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { showErrorNotification } from "@/lib/errorNotifier";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { useCanEditProject } from "@/store/auth";

const READS_KEY = "settings.ai.askBeforeProductionReads";
const WRITES_KEY = "settings.ai.askBeforeProductionWrites";

/**
 * Whether the agent asks before it touches production (#737). Both are on
 * until a creator turns them off; turning one off says what that risks.
 */
export function ProductionAskSettings({
	projectId,
	settings,
}: {
	projectId: string;
	settings: Record<string, string>;
}) {
	const canEdit = useCanEditProject(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);
	const reads = settings[READS_KEY] !== "false";
	const writes = settings[WRITES_KEY] !== "false";

	const save = (key: string, on: boolean, what: string) =>
		upsert.mutate({ key, value: on ? "true" : "false" } as RequestBodySchema, {
			onSuccess: () => toast.success(`${what} saved`),
			onError: (e) => showErrorNotification(e as Error),
		});

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
			<div>
				<h3 className="font-medium text-foreground">Production access</h3>
				<p className="text-sm text-muted">
					The agent works in development. It only goes to production when you ask it to, and then it
					waits for your approval, in auto mode too.
					{canEdit ? "" : " Only a creator can change these."}
				</p>
			</div>
			<Checkbox
				isSelected={reads}
				isDisabled={!canEdit}
				onChange={(on: boolean) => save(READS_KEY, on, "Ask before production reads")}
				label="Ask before production reads"
				description="Logs, recordings, KV keys, app config values and integration configs of production."
			/>
			{!reads && (
				<p role="alert" className="text-sm text-warning">
					The agent can read production logs, recordings and values without asking. They may hold
					secrets and customer data.
				</p>
			)}
			<Checkbox
				isSelected={writes}
				isDisabled={!canEdit}
				onChange={(on: boolean) => save(WRITES_KEY, on, "Ask before production writes")}
				label="Ask before production writes"
				description="Setting a production app config value or integration config, and saving a trigger."
			/>
			{!writes && (
				<p role="alert" className="text-sm text-danger">
					The agent can change production values and triggers without asking.
				</p>
			)}
		</div>
	);
}
