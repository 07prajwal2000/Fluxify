import { Button, CloseButton, Modal, Spinner } from "@fluxify/components";
import { TbTimeline } from "react-icons/tb";
import { RecordedRunViewer } from "@/components/recordings/RecordedRunViewer";
import { recordingsQuery } from "@/query/recordingsQuery";
import type { SuiteTarget } from "@/services/testSuites";
import { type caseTraceLink, failingBlock } from "./traceLinks";

export type OpenTrace = { traceRunId: string; failed: boolean };

/** "View trace" for one case (#627), or "Trace expired" once it is gone */
export function TraceLink({
	link,
	failed,
	onOpen,
}: {
	link: ReturnType<typeof caseTraceLink>;
	failed: boolean;
	onOpen: (trace: OpenTrace) => void;
}) {
	if (link === "expired") return <p className="text-xs text-muted">Trace expired</p>;
	if (!link) return null;
	return (
		<Button
			size="sm"
			variant="ghost"
			onPress={() => onOpen({ traceRunId: link.traceRunId, failed })}
		>
			<TbTimeline size={14} /> View trace
		</Button>
	);
}

/** a test case's trace in the run viewer; a failed case opens on the block it failed in */
export function TestTraceModal({
	projectId,
	target,
	trace,
	onClose,
}: {
	projectId: string;
	target: SuiteTarget;
	trace: OpenTrace | null;
	onClose: () => void;
}) {
	return (
		<Modal isOpen={!!trace} onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="cover" className="p-0">
					<Modal.Dialog className="flex h-[min(820px,86vh)] w-[min(1600px,96vw)] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50">
						<Modal.Header className="flex h-11 shrink-0 flex-row items-center border-b border-border px-4 py-0">
							<Modal.Heading className="text-sm font-semibold">Test trace</Modal.Heading>
							<CloseButton aria-label="Close test trace" className="ml-auto" />
						</Modal.Header>
						<Modal.Body className="min-h-0 flex-1 p-0">
							{trace && (
								<TraceBody projectId={projectId} target={target} trace={trace} onClose={onClose} />
							)}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

function TraceBody({
	projectId,
	target,
	trace,
	onClose,
}: {
	projectId: string;
	target: SuiteTarget;
	trace: OpenTrace;
	onClose: () => void;
}) {
	// the viewer reads the same cached run; waiting here lets it open on the failing block
	const run = recordingsQuery.getRun.useQuery(projectId, target, trace.traceRunId);
	if (run.isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner />
			</div>
		);
	}
	return (
		<RecordedRunViewer
			projectId={projectId}
			target={target}
			runId={trace.traceRunId}
			onBack={onClose}
			initialSelected={trace.failed && run.data ? failingBlock(run.data.spans) : null}
		/>
	);
}
