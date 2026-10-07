import { CloseButton, DeleteButton, Modal } from "@fluxify/components";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { recordingsQuery } from "@/query/recordingsQuery";
import type { RecordingTarget } from "@/services/recordings";
import { RecordedRunList } from "./RecordedRunList";
import { RecordedRunViewer } from "./RecordedRunViewer";
import { RecordButton } from "./RecordingControls";

/**
 * Recorded runs of one route or workflow: the record button and the run list,
 * or one run on its canvas. Mount it only while it is on screen — the list
 * polls for as long as it is mounted.
 */
export function ExecutionRecordings({
	projectId,
	target,
	emptyHint,
}: {
	projectId: string;
	target: RecordingTarget;
	emptyHint: string;
}) {
	const [runId, setRunId] = useState<string | null>(null);
	const [confirmClear, setConfirmClear] = useState(false);
	const clear = recordingsQuery.clearRuns.useMutation(projectId, target);

	if (runId) {
		return (
			<RecordedRunViewer
				key={runId}
				projectId={projectId}
				target={target}
				runId={runId}
				onBack={() => setRunId(null)}
			/>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
				<RecordButton projectId={projectId} target={target} />
				<span className="text-xs text-muted">
					Recording keeps each run here, inputs and outputs included, so you can replay it on the
					canvas.
				</span>
				<DeleteButton size="sm" className="ml-auto" onPress={() => setConfirmClear(true)}>
					Clear all
				</DeleteButton>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<RecordedRunList
					projectId={projectId}
					target={target}
					emptyHint={emptyHint}
					onOpen={(run) => setRunId(run.id)}
				/>
			</div>
			<ConfirmDialog
				open={confirmClear}
				onOpenChange={setConfirmClear}
				title="Clear all recordings?"
				danger
				confirmText="Clear"
				pending={clear.isPending}
				onConfirm={() =>
					clear.mutate(undefined, {
						onSuccess: () => setConfirmClear(false),
						onError: (error) => showErrorNotification(error),
					})
				}
			>
				Every recorded run of this {target.type} is deleted. This can't be undone.
			</ConfirmDialog>
		</div>
	);
}

/** Workflows have no playground, so their recordings open in a modal of their own. */
export function WorkflowRecordingsModal({
	projectId,
	workflowId,
	isOpen,
	onOpenChange,
}: {
	projectId: string;
	workflowId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="cover" className="p-0">
					<Modal.Dialog className="flex h-[min(820px,86vh)] w-[min(1600px,96vw)] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50">
						<Modal.Header className="flex h-11 shrink-0 flex-row items-center border-b border-border px-4 py-0">
							<Modal.Heading className="text-sm font-semibold">Track Execution</Modal.Heading>
							<CloseButton aria-label="Close Track Execution" className="ml-auto" />
						</Modal.Header>
						<Modal.Body className="min-h-0 flex-1 p-0">
							<ExecutionRecordings
								projectId={projectId}
								target={{ type: "workflow", id: workflowId }}
								emptyHint="run the workflow with the Run button or its trigger"
							/>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
