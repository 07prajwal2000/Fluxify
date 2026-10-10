import { Button } from "@fluxify/components";
import { TbPlayerPlay } from "react-icons/tb";
import { RunPayloadModal } from "@/components/workflows/WorkflowRunModal";
import { sandboxesQuery } from "@/query/sandboxesQuery";
import { useCanEditProject } from "@/store/auth";
import { DEV_WORKER_MESSAGE } from "./sandboxRequest";

/** Off for viewers, and while no development worker is up to take the run. */
export function SandboxRunButton({
	projectId,
	online,
	onPress,
}: {
	projectId: string;
	online: boolean;
	onPress: () => void;
}) {
	const canRun = useCanEditProject(projectId);
	return (
		<Button variant="outline" isDisabled={!online || !canRun} onPress={onPress}>
			<TbPlayerPlay size={16} /> Run
		</Button>
	);
}

/** The workflow Run form, pointed at the sandbox. A 409 stays in the dialog as text. */
export function SandboxRunModal({
	projectId,
	sandboxId,
	name,
	online,
	isOpen,
	onOpenChange,
}: {
	projectId: string;
	sandboxId: string;
	name: string;
	online: boolean;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const run = sandboxesQuery.run.mutation(projectId, sandboxId);
	return (
		<RunPayloadModal
			heading="Run sandbox"
			name={name}
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			isDisabled={!online}
			disabledReason={DEV_WORKER_MESSAGE}
			run={(payload) => run.mutateAsync(payload)}
		/>
	);
}
