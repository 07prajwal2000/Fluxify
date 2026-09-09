import { useEffect, useState } from "react";
import { Button, Label, NumberField, Spinner, toast } from "@fluxify/components";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { showErrorNotification } from "@/lib/errorNotifier";

const KEY = "settings.triggers.maxPayloadBytes";
const DEFAULT_BYTES = 64 * 1024;
const MAX_BYTES = 256 * 1024;

/** Bytes as KB, so nobody has to type 65536. */
const toKb = (bytes: number) => Math.round(bytes / 1024);

export function TriggerSettings({ projectId }: { projectId: string }) {
	const { data, isLoading } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);
	const saved = Number((data as Record<string, string> | undefined)?.[KEY]);
	const [kb, setKb] = useState(toKb(DEFAULT_BYTES));

	useEffect(() => {
		if (Number.isFinite(saved) && saved > 0) setKb(toKb(saved));
	}, [saved]);

	function save() {
		upsert.mutate(
			{ key: KEY, value: String(kb * 1024) } as RequestBodySchema,
			{
				onSuccess: () => toast.success("Trigger limit saved"),
				onError: (error) => showErrorNotification(error as Error),
			},
		);
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
				<h3 className="font-medium text-foreground">Trigger payload limit</h3>
				<p className="text-sm text-muted">
					The largest payload the Trigger Workflow block may send. A bigger
					payload is rejected when the block runs, so the workflow never starts.
				</p>
			</div>

			<NumberField
				value={kb}
				minValue={1}
				maxValue={toKb(MAX_BYTES)}
				onChange={(next) =>
					setKb(Math.min(toKb(MAX_BYTES), Math.max(1, next || 1)))
				}
				className="w-52"
			>
				<Label>Maximum payload (KB)</Label>
				<NumberField.Group>
					<NumberField.DecrementButton />
					<NumberField.Input />
					<NumberField.IncrementButton />
				</NumberField.Group>
			</NumberField>

			<p className="text-xs text-muted">
				Defaults to {toKb(DEFAULT_BYTES)} KB and cannot go above{" "}
				{toKb(MAX_BYTES)} KB. If you need to move more than that, send a
				reference — an id, a file key — and let the workflow fetch it, or use a
				dedicated trigger with an integration built for payloads that size.
			</p>

			<Button
				variant="primary"
				size="sm"
				className="self-start"
				isPending={upsert.isPending}
				onPress={save}
			>
				Save
			</Button>
		</div>
	);
}
