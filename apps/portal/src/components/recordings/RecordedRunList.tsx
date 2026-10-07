import { Button, Chip, cn, DeleteIconButton } from "@fluxify/components";
import { useEffect, useState } from "react";
import { TbCheck, TbPlayerRecord, TbX } from "react-icons/tb";
import { EmptyState } from "@/components/common/EmptyState";
import { formatDuration } from "@/components/testSuites/CaseResults";
import { formatWhen } from "@/components/testSuites/RunResults";
import { showErrorNotification } from "@/lib/errorNotifier";
import { recordingsQuery, useRecordingSwitch } from "@/query/recordingsQuery";
import { routesQuery } from "@/query/routesQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import type { RecordedRunSummary, RecordingTarget } from "@/services/recordings";
import { useRetentionNote } from "./RecordingControls";
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
	const [outcomeFilter, setOutcomeFilter] = useState<"all" | "success" | "failure">("all");
	const [focusedIndex, setFocusedIndex] = useState(-1);
	const retentionNote = useRetentionNote();

	// "5m ago" is worked out at render; re-render each minute so it keeps moving
	const [, setNow] = useState(0);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);

	const route = routesQuery.byId.useQuery(target.type === "route" ? target.id : "");
	const workflow = workflowsQuery.byId.useQuery(target.type === "workflow" ? target.id : "");

	const runs = recordingsQuery.getRuns.useQuery(
		projectId,
		target,
		page,
		true,
		outcomeFilter === "all" ? undefined : outcomeFilter,
	);
	const remove = recordingsQuery.deleteRun.useMutation(projectId, target);
	const recording = useRecordingSwitch(projectId, target);

	const items = runs.data?.data ?? [];

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (items.length === 0) return;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setFocusedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setFocusedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
			} else if (e.key === "Enter" && focusedIndex >= 0 && items[focusedIndex]) {
				e.preventDefault();
				onOpen(items[focusedIndex]);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [items, focusedIndex, onOpen]);

	if (runs.isLoading) {
		return (
			<div className="space-y-2 p-4">
				{[1, 2, 3, 4].map((n) => (
					<div
						key={n}
						className="h-12 w-full animate-pulse rounded-lg border border-border bg-background-secondary/50"
					/>
				))}
			</div>
		);
	}

	if (items.length === 0 && page === 1 && outcomeFilter === "all") {
		return (
			<div className="p-6">
				<EmptyState
					icon={<TbPlayerRecord size={24} />}
					title={recording.isOn ? "Waiting for the first run" : "Recording is off"}
					description={
						recording.isOn
							? `Recording is on. To see a run here, ${emptyHint}. ${retentionNote}`
							: `Turn recording on with the Record button, then ${emptyHint}. ${retentionNote}`
					}
				/>
			</div>
		);
	}

	const pagination = runs.data?.pagination;
	return (
		<div className="space-y-3 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
				<div className="flex items-center gap-2">
					{target.type === "route" && route.data && (
						<span className="font-mono text-xs text-foreground">
							<span className="font-semibold text-accent">{route.data.method.toUpperCase()}</span>{" "}
							<span className="text-muted">{route.data.path}</span>
						</span>
					)}
					{target.type === "workflow" && workflow.data && (
						<span className="text-xs font-medium text-foreground">
							{workflow.data.name || "Workflow"}
						</span>
					)}
					<span className="text-xs text-muted">· {retentionNote}</span>
				</div>

				<div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
					<button
						type="button"
						onClick={() => {
							setOutcomeFilter("all");
							setPage(1);
							setFocusedIndex(-1);
						}}
						className={cn(
							"rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
							outcomeFilter === "all"
								? "bg-accent/10 text-accent"
								: "text-muted hover:text-foreground",
						)}
					>
						All
					</button>
					<button
						type="button"
						onClick={() => {
							setOutcomeFilter("success");
							setPage(1);
							setFocusedIndex(-1);
						}}
						className={cn(
							"rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
							outcomeFilter === "success"
								? "bg-success/10 text-success"
								: "text-muted hover:text-foreground",
						)}
					>
						Passed
					</button>
					<button
						type="button"
						onClick={() => {
							setOutcomeFilter("failure");
							setPage(1);
							setFocusedIndex(-1);
						}}
						className={cn(
							"rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
							outcomeFilter === "failure"
								? "bg-danger/10 text-danger"
								: "text-muted hover:text-foreground",
						)}
					>
						Failed
					</button>
				</div>
			</div>

			{items.length === 0 ? (
				<div className="py-8 text-center text-xs text-muted">
					No runs found matching filter "{outcomeFilter}".
				</div>
			) : (
				items.map((run, index) => (
					<div
						key={run.id}
						className={cn(
							"flex items-center gap-2 rounded-lg border bg-background-secondary pr-2 transition-colors",
							focusedIndex === index
								? "border-accent ring-1 ring-accent"
								: "border-border hover:border-accent/40",
						)}
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
							<span className="flex-1 truncate text-xs text-muted">
								{formatWhen(run.startedAt)}
							</span>
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
								remove.mutate(run.id, {
									onError: (error: Error) => showErrorNotification(error),
								})
							}
						/>
					</div>
				))
			)}

			{pagination && (page > 1 || pagination.hasNext) && (
				<div className="flex items-center justify-between pt-1">
					<Button
						variant="ghost"
						size="sm"
						isDisabled={page <= 1}
						onPress={() => {
							setPage((p) => p - 1);
							setFocusedIndex(-1);
						}}
					>
						Newer
					</Button>
					<span className="text-xs text-muted">Page {page}</span>
					<Button
						variant="ghost"
						size="sm"
						isDisabled={!pagination.hasNext}
						onPress={() => {
							setPage((p) => p + 1);
							setFocusedIndex(-1);
						}}
					>
						Older
					</Button>
				</div>
			)}
		</div>
	);
}
