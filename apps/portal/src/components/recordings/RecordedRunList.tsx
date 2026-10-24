import {
	Button,
	Chip,
	CustomSelect,
	cn,
	DeleteIconButton,
	Input,
	TextField,
} from "@fluxify/components";
import { useEffect, useState } from "react";
import { TbCheck, TbPlayerRecord, TbSearch, TbX } from "react-icons/tb";
import { EmptyState } from "@/components/common/EmptyState";
import { formatDuration } from "@/components/testSuites/CaseResults";
import { showErrorNotification } from "@/lib/errorNotifier";
import { PAGE_SIZES, usePageSize } from "@/lib/pageSize";
import { recordingsQuery, useRecordingSwitch } from "@/query/recordingsQuery";
import { routesQuery } from "@/query/routesQuery";
import { sandboxesQuery } from "@/query/sandboxesQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import type { RecordedRunSummary, RecordingTarget } from "@/services/recordings";
import { useRetentionNote } from "./RecordingControls";
import { RecordingTime } from "./RecordingTime";
import { isIncomplete } from "./spans";

type EnvFilter = "all" | "development" | "production";
const ENV_OPTIONS = [
	{ value: "all", label: "All environments" },
	{ value: "development", label: "Development" },
	{ value: "production", label: "Production" },
];
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} / page` }));

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
	showSourceFilter = true,
	versionId,
	onClearVersionFilter,
}: {
	projectId: string;
	target: RecordingTarget;
	/** how to produce a run, e.g. "switch to the API Playground tab and send a request" */
	emptyHint: string;
	onOpen: (run: RecordedRunSummary) => void;
	/** the All / Test / Live switch; hide it where a target has no test runs (a sandbox) */
	showSourceFilter?: boolean;
	/** only production runs that served this version (#739), from the version menu */
	versionId?: string;
	/** drops the version filter */
	onClearVersionFilter?: () => void;
}) {
	const [page, setPage] = useState(1);
	const [outcomeFilter, setOutcomeFilter] = useState<"all" | "success" | "failure">("all");
	const [sourceFilter, setSourceFilter] = useState<"all" | "test" | "live">("all");
	const [envFilter, setEnvFilter] = useState<EnvFilter>("all");
	const [focusedIndex, setFocusedIndex] = useState(-1);
	const [perPage, setPerPage] = usePageSize("recordedRuns");
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const retentionNote = useRetentionNote();

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(search.trim());
			setPage(1);
			setFocusedIndex(-1);
		}, 300);
		return () => clearTimeout(timer);
	}, [search]);

	const route = routesQuery.byId.useQuery(target.type === "route" ? target.id : "");
	const workflow = workflowsQuery.byId.useQuery(target.type === "workflow" ? target.id : "");
	const sandbox = sandboxesQuery.byId.useQuery(
		projectId,
		target.type === "sandbox" ? target.id : "",
	);

	const runs = recordingsQuery.getRuns.useQuery(
		projectId,
		target,
		page,
		true,
		outcomeFilter === "all" ? undefined : outcomeFilter,
		{
			...(sourceFilter === "all" ? {} : { source: sourceFilter }),
			...(versionId ? { versionId } : {}),
			perPage,
			...(debouncedSearch ? { search: debouncedSearch } : {}),
		},
		envFilter === "all" ? undefined : envFilter,
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

	if (
		items.length === 0 &&
		page === 1 &&
		outcomeFilter === "all" &&
		sourceFilter === "all" &&
		envFilter === "all" &&
		!debouncedSearch
	) {
		return (
			<div className="p-6">
				<EmptyState
					icon={<TbPlayerRecord size={24} />}
					title={recording.isRecording ? "Waiting for the first run" : "Recording is off"}
					description={
						recording.isRecording
							? `Recording is on. To see a run here, ${emptyHint}. ${retentionNote}`
							: `Turn recording on with the Record button, then ${emptyHint}. ${retentionNote}`
					}
				/>
			</div>
		);
	}

	const pagination = runs.data?.pagination;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 space-y-3 px-4 pt-4">
				{versionId && (
					<div className="flex items-center gap-2 rounded-md border border-border bg-background-secondary px-3 py-1.5 text-xs text-muted">
						<span>Showing the production runs of one version.</span>
						{onClearVersionFilter && (
							<button
								type="button"
								onClick={onClearVersionFilter}
								className="text-accent hover:underline"
							>
								Show all runs
							</button>
						)}
					</div>
				)}
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
						{target.type === "sandbox" && sandbox.data && (
							<span className="text-xs font-medium text-foreground">{sandbox.data.name}</span>
						)}
						<span className="text-xs text-muted">· {retentionNote}</span>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<TextField
							aria-label="Search runs"
							value={search}
							onChange={setSearch}
							className="relative w-56"
						>
							<TbSearch
								className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted"
								size={14}
							/>
							<Input placeholder="Status code, run id or test" className="pl-8" />
						</TextField>
						{showSourceFilter && (
							<div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
								{(
									[
										["all", "All runs"],
										["test", "Test runs"],
										["live", "Live runs"],
									] as const
								).map(([value, label]) => (
									<button
										key={value}
										type="button"
										aria-pressed={sourceFilter === value}
										onClick={() => {
											setSourceFilter(value);
											setPage(1);
											setFocusedIndex(-1);
										}}
										className={cn(
											"rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
											sourceFilter === value
												? "bg-accent/10 text-accent"
												: "text-muted hover:text-foreground",
										)}
									>
										{label}
									</button>
								))}
							</div>
						)}
						{target.type !== "sandbox" && (
							<div className="w-48">
								<CustomSelect
									aria-label="Filter by environment"
									options={ENV_OPTIONS}
									value={envFilter}
									onChange={(value) => {
										setEnvFilter(value as EnvFilter);
										setPage(1);
										setFocusedIndex(-1);
									}}
								/>
							</div>
						)}
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
				</div>
			</div>

			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
				{items.length === 0 ? (
					<div className="py-8 text-center text-xs text-muted">No runs match these filters.</div>
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
								{target.type === "route" && run.statusCode != null && (
									<span className="font-mono text-xs text-foreground">Status {run.statusCode}</span>
								)}
								<span className="shrink-0 font-mono text-[11px] text-foreground">{run.graph}</span>
								<Chip size="sm" color={run.values === "development" ? "accent" : "default"}>
									{run.values === "development" ? "Dev" : "Prod"}
								</Chip>
								{run.metadata && (
									<Chip size="sm" color="accent" title={run.metadata.label}>
										Test
									</Chip>
								)}
								<span className="flex-1 truncate text-xs text-muted">
									{run.metadata && <span className="text-foreground">{run.metadata.label} · </span>}
									<RecordingTime timestamp={run.startedAt} />
								</span>
								{run.parentRunId && (
									<Chip size="sm" title="Forked by an async custom block">
										Async
									</Chip>
								)}
								<IncompleteChip run={run} />
								<span className="text-xs text-muted">{run.spanCount} blocks</span>
								<span className="shrink-0 text-right text-xs text-muted">
									{target.type === "workflow" ? "Duration" : "Response time"}{" "}
									{formatDuration(run.durationMs)}
								</span>
							</button>
							{/* a sandbox keeps its runs until it is deleted */}
							{target.type !== "sandbox" && (
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
							)}
						</div>
					))
				)}
			</div>

			<div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2">
				<div className="w-32">
					<CustomSelect
						aria-label="Runs per page"
						options={PAGE_SIZE_OPTIONS}
						value={String(perPage)}
						onChange={(value) => {
							setPerPage(Number(value));
							setPage(1);
							setFocusedIndex(-1);
						}}
					/>
				</div>
				{pagination && (page > 1 || pagination.hasNext) && (
					<div className="flex items-center gap-3">
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
						<span className="text-xs text-muted">
							Page {page} of {Math.max(pagination.totalPages, 1)}
						</span>
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
		</div>
	);
}
