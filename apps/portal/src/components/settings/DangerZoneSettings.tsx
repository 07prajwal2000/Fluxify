import { TbAlertTriangle } from "react-icons/tb";
import { Button, toast } from "@fluxify/components";

export function DangerZoneSettings({ projectId }: { projectId: string }) {
	function handleDelete() {
		// Placeholder for actual delete logic
		toast.danger("Delete project is not implemented yet on the server.");
	}

	return (
		<div className="rounded-xl border border-red-900/50 bg-red-950/20 p-6">
			<div className="flex items-center gap-2 text-red-400">
				<TbAlertTriangle size={20} />
				<h2 className="text-lg font-medium tracking-tight">Danger Zone</h2>
			</div>
			<p className="mt-2 text-sm text-zinc-400">
				Delete project will remove all workflows, logs and members.
			</p>
			<div className="mt-6">
				<Button
					onPress={handleDelete}
					className="border border-[#5c1616] bg-[#3a0e0e] text-red-200 transition-colors hover:bg-[#5c1616] hover:text-red-100"
				>
					Delete project
				</Button>
			</div>
		</div>
	);
}
