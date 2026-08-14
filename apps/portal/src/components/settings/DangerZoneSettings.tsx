import { TbAlertTriangle } from "react-icons/tb";
import { DeleteButton, toast } from "@fluxify/components";

export function DangerZoneSettings({ projectId }: { projectId: string }) {
	function handleDelete() {
		// Placeholder for actual delete logic
		toast.danger("Delete project is not implemented yet on the server.");
	}

	return (
		<div className="rounded-xl border border-danger/30 bg-danger/10 p-6">
			<div className="flex items-center gap-2 text-danger">
				<TbAlertTriangle size={20} />
				<h2 className="text-lg font-medium tracking-tight">Danger Zone</h2>
			</div>
			<p className="mt-2 text-sm text-muted">
				Delete project will remove all workflows, logs and members.
			</p>
			<div className="mt-6">
				<DeleteButton
					onPress={handleDelete}
				>
					Delete project
				</DeleteButton>
			</div>
		</div>
	);
}
