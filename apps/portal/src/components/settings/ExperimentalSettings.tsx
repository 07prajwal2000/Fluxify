import { Switch, Spinner, toast } from "@fluxify/components";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { showErrorNotification } from "@/lib/errorNotifier";

export function ExperimentalSettings({ projectId }: { projectId: string }) {
	const { data, isLoading } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);

	const settings = (data ?? {}) as Record<string, string>;
	const timeoutsEnabled = settings["experimental.workerTimeouts.enabled"] === "true";

	function handleToggle(value: boolean) {
		upsert.mutate(
			{ key: "experimental.workerTimeouts.enabled", value: value ? "true" : "false" } as RequestBodySchema,
			{
				onSuccess: () => toast.success("Experimental setting saved"),
				onError: (e) => showErrorNotification(e as Error),
			}
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">Experimental</h1>
				<p className="text-sm text-muted">Features that are still under active development.</p>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : (
				<div className="flex flex-col gap-4">
					<div className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-4">
						<div className="flex flex-col gap-1">
							<h3 className="font-medium text-foreground">Worker Timeouts</h3>
							<p className="text-sm text-muted">Enable experimental execution worker timeouts to prevent long-running tasks from hanging.</p>
						</div>
						<Switch isSelected={timeoutsEnabled} onChange={(e: any) => handleToggle(e.target.checked)} />
					</div>
				</div>
			)}
		</div>
	);
}
