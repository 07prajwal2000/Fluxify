import { toast } from "@fluxify/components";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DeleteBlocked } from "@/components/versions/DeleteBlocked";
import { showErrorNotification } from "@/lib/errorNotifier";
import { pluginsQuery } from "@/query/pluginsQuery";
import { type Reference, referencesFromDeleteError } from "@/services/references";

/**
 * Removing a plugin is refused (409) while a route, workflow or custom block
 * uses one of its blocks; the dialog stays open and lists them as links.
 */
export function RemovePluginDialog({
	projectId,
	name,
	open,
	onOpenChange,
	onRemoved,
}: {
	projectId: string;
	name: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRemoved: () => void;
}) {
	const remove = pluginsQuery.remove.useMutation(projectId);
	const [blocked, setBlocked] = useState<{ message: string; references: Reference[] }>();

	function confirm() {
		remove.mutate(name, {
			onSuccess: () => {
				toast.success(`${name} removed`);
				onOpenChange(false);
				onRemoved();
			},
			onError: (e) => {
				const conflict = referencesFromDeleteError(e);
				if (conflict) setBlocked(conflict);
				else showErrorNotification(e);
			},
		});
	}

	return (
		<ConfirmDialog
			open={open}
			onOpenChange={(o) => {
				if (!o) setBlocked(undefined);
				onOpenChange(o);
			}}
			title={`Remove ${name}?`}
			confirmText="Remove"
			danger
			pending={remove.isPending}
			onConfirm={confirm}
		>
			Its blocks stop loading on every worker, which restart gracefully. Routes, workflows and
			custom blocks that use it must drop it first.
			{blocked && (
				<DeleteBlocked
					message={blocked.message}
					references={blocked.references}
					projectId={projectId}
				/>
			)}
		</ConfirmDialog>
	);
}
