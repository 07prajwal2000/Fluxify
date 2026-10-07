import { Button, Chip, DeleteIconButton, Spinner } from "@fluxify/components";
import { useEffect, useState } from "react";
import { TbCheck, TbPlayerRecord, TbX } from "react-icons/tb";
import { EmptyState } from "@/components/common/EmptyState";
import { formatDuration } from "@/components/testSuites/CaseResults";
import { formatWhen } from "@/components/testSuites/RunResults";
import { showErrorNotification } from "@/lib/errorNotifier";
import { recordingsQuery, useRecordingSwitch } from "@/query/recordingsQuery";
import type { RecordedRunSummary, RecordingTarget } from "@/services/recordings";
import { RETENTION_NOTE } from "./RecordingControls";
import { isIncomplete } from "./spans";

export function OutcomeIcon({ outcome }: { outcome: "success" | "failure" }) {
	return outcome === "success" ? (
		<TbCheck size={15} className="shrink-0 text-success" aria-label="Succeeded" />
	) : (
		<TbX size={15} className="shrink-0 text-danger" aria-label="Failed" />
	);
}

export function IncompleteChip({ run }: { run: Parameters<typeof isIncomplete>[0] }) {
	if (!isIncomplete(run)) return null;
	const why =
		run.durationMs === null
			? "The run never finished."
			: "Some values or spans were cut to fit the recording limits.";
	return (
		<Chip size="sm" color="warning" title={why}>
			Incomplete
		</Chip>
	);
}

/** Recorded runs, newest first, re-read every few seconds while on screen. */
export function RecordedRunList({
	projectId,
	target,
	emptyHint,
	onOpen,
}: {
	projectId: string;
	target: RecordingTarget;
	/** how to produce a run, e.g. "switch to the API Playground tab and send a request" */
	emptyHint: string;
	onOpen: (run: RecordedRunSummary) => void;
}) {
	const [page, setPage] = useState(1);
	// "5m ago" is worked out at render; re-render each minute so it keeps moving
	const [, setNow] = useState(0);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);
	const runs = recordingsQuery.getRuns.useQuery(projectId, target, page, true);
	const remove = recordingsQuery.deleteRun.mutation(projectId, target);
	const recording = useRecordingSwitch(projectId, target);

	if (runs.isLoading) {
		return (
			<div className="flex justify-center p-6">
				<Spinner size="sm" />
			</div>
		);
	}

	const items = runs.data?.data ?? [];
	if (items.length === 0 && page === 1) {
		return (
			<div className="p-6">
				<EmptyState
					icon={<TbPlayerRecord size={24} />}
					title={recording.isOn ? "Waiting for the first run" : "Recording is off"}
					description={
						recording.isOn
							? `Recording is on. To see a run here, ${emptyHint}. ${RETENTION_NOTE}`
							: `Turn recording on with the Record button, then ${emptyHint}. ${RETENTION_NOTE}`
					}
				/>
			</div>
		);
	}

	const pagination = runs.data?.pagination;
	return (
		<div className="space-y-2 p-4">
			<p className="text-xs text-muted">{RETENTION_NOTE}</p>
			{items.map((run) => (
				<div
					key={run.id}
					className="flex items-center gap-2 rounded-lg border border-border bg-background-secondary pr-2 hover:border-accent/40"
				>
					<button
						type="button"
						onClick={() => onOpen(run)}
						className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 p-3 text-left"
					>
						<OutcomeIcon outcome={run.outcome} />
						{run.statusCode != null && (
							<span className="font-mono text-xs text-foreground">{run.statusCode}</span>
						)}
						<span className="flex-1 truncate text-xs text-muted">{formatWhen(run.startedAt)}</span>
						{run.parentRunId && (
							<Chip size="sm" title="Forked by an async custom block">
								Async
							</Chip>
						)}
						<IncompleteChip run={run} />
						<span className="text-xs text-muted">{run.spanCount} blocks</span>
						<span className="w-16 text-right text-xs text-muted">
							{formatDuration(run.durationMs)}
						</span>
					</button>
					<DeleteIconButton
						size="sm"
						aria-label="Delete recorded run"
						isDisabled={remove.isPending && remove.variables === run.id}
						onPress={() =>
							remove.mutate(run.id, { onError: (error) => showErrorNotification(error) })
						}
					/>
				</div>
			))}

			{pagination && (page > 1 || pagination.hasNext) && (
				<div className="flex items-center justify-between pt-1">
					<Button
						variant="ghost"
						size="sm"
						isDisabled={page <= 1}
						onPress={() => setPage((p) => p - 1)}
					>
						Newer
					</Button>
					<span className="text-xs text-muted">Page {page}</span>
					<Button
						variant="ghost"
						size="sm"
						isDisabled={!pagination.hasNext}
						onPress={() => setPage((p) => p + 1)}
					>
						Older
					</Button>
				</div>
			)}
		</div>
	);
}
