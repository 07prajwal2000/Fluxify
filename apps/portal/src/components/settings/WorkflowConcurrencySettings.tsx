import { Button, Label, NumberField, Spinner, toast } from "@fluxify/components";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { useEffect, useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { useIsProjectAdmin } from "@/store/auth";

const KEY = "settings.workflows.triggerConcurrency";
const DEFAULT_RUNS = 10;
const MAX_RUNS = 100;

/** Project settings > General: how many Trigger Workflow runs may be in flight at once. */
export function WorkflowConcurrencySettings({ projectId }: { projectId: string }) {
	const { data, isLoading } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);
	const isAdmin = useIsProjectAdmin(projectId);
	const saved = Number((data as Record<string, string> | undefined)?.[KEY]) || DEFAULT_RUNS;
	const [runs, setRuns] = useState(saved);

	useEffect(() => setRuns(saved), [saved]);

	function save() {
		upsert.mutate({ key: KEY, value: String(runs) } as RequestBodySchema, {
			onSuccess: () => toast.success("Workflow concurrency saved"),
			onError: (error) => showErrorNotification(error as Error),
		});
	}

	if (isLoading) {
		return (
			<div className="flex justify-center py-8">
				<Spinner />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
			<div>
				<h3 className="font-medium text-foreground">Trigger Workflow concurrency</h3>
				<p className="text-sm text-muted">
					How many runs started by a Trigger Workflow block may be in progress at once. Further runs
					wait their turn.
					{isAdmin ? "" : " Only a project admin can change this."}
				</p>
			</div>

			<NumberField
				value={runs}
				minValue={1}
				maxValue={MAX_RUNS}
				step={1}
				isDisabled={!isAdmin}
				onChange={(next) => setRuns(Math.min(MAX_RUNS, Math.max(1, next || 1)))}
				className="w-52"
			>
				<Label>Runs at once</Label>
				<NumberField.Group>
					<NumberField.DecrementButton />
					<NumberField.Input />
					<NumberField.IncrementButton />
				</NumberField.Group>
			</NumberField>

			<p className="text-xs text-muted">
				Defaults to {DEFAULT_RUNS}, up to {MAX_RUNS}. A change applies to running workers at once.
				Runs no longer start strictly in the order they were fired. Set this to 1 if your workflows
				depend on that order.
			</p>

			{isAdmin && runs !== saved && (
				<Button
					variant="primary"
					size="sm"
					className="self-start"
					isPending={upsert.isPending}
					onPress={save}
				>
					Save
				</Button>
			)}
		</div>
	);
}
