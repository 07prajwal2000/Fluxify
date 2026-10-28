import { Button, Chip, cn, DeleteButton, Spinner, Tabs } from "@fluxify/components";
import type { SuiteRunResult } from "@fluxify/server/src/db/schema";
import { useEffect, useRef, useState } from "react";
import {
	TbAlertTriangle,
	TbCheck,
	TbChevronDown,
	TbChevronRight,
	TbClock,
	TbX,
} from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { testSuitesQuery } from "@/query/testSuitesQuery";
import type { SuiteTarget, TestRunStatus } from "@/services/testSuites";
import { CaseResults, CheckList, formatDuration } from "./CaseResults";
import { ResponseViewer } from "./ResponseViewer";
import { RunDebugError } from "./RunDebugError";
import { type OpenTrace, TestTraceModal, TraceLink } from "./TestTrace";
import { type CaseTrace, caseTraceLink } from "./traceLinks";

const TERMINAL_TONE: Record<string, string> = {
	passed: "text-success",
	failed: "text-danger",
	timeout: "text-warning",
	error: "text-danger",
	running: "text-warning",
	queued: "text-muted",
};

function StatusIcon({ status }: { status: TestRunStatus }) {
	const className = cn("shrink-0", TERMINAL_TONE[status]);
	if (status === "passed") return <TbCheck size={15} className={className} />;
	if (status === "failed" || status === "error") return <TbX size={15} className={className} />;
	if (status === "timeout") return <TbAlertTriangle size={15} className={className} />;
	return <TbClock size={15} className={cn(className, "animate-pulse")} />;
}

function SuiteRunRow({
	projectId,
	target,
	name,
	status,
	durationMs,
	result,
	traces,
	traceExpired,
	onViewTrace,
}: {
	projectId: string;
	target: SuiteTarget;
	name: string;
	status: TestRunStatus;
	durationMs: number | null;
	result: SuiteRunResult | null;
	traces: CaseTrace[];
	traceExpired: boolean;
	onViewTrace: (trace: OpenTrace) => void;
}) {
	const [open, setOpen] = useState(false);
	const assertions = result?.result ?? [];

	return (
		<div className="rounded-lg border border-border bg-background-secondary">
			<div
				role="button"
				tabIndex={0}
				onClick={() => setOpen((v) => !v)}
				onKeyDown={(e) => e.key === "Enter" && setOpen((v) => !v)}
				className="flex cursor-pointer items-center gap-2 p-3"
			>
				<StatusIcon status={status} />
				<span className="min-w-0 flex-1 truncate text-xs text-foreground">{name}</span>
				{result?.teardownError && (
					<span className="flex items-center gap-1 text-xs text-warning">
						<TbAlertTriangle size={14} /> Teardown failed
					</span>
				)}
				{result?.counts && (
					<span className="text-xs text-muted">
						{result.counts.passed}/{result.counts.total} cases
					</span>
				)}
				{result?.statusCode != null && (
					<span className="font-mono text-xs text-muted">{result.statusCode}</span>
				)}
				<span className="text-xs text-muted">{formatDuration(durationMs)}</span>
				{open ? (
					<TbChevronDown size={15} className="text-muted" />
				) : (
					<TbChevronRight size={15} className="text-muted" />
				)}
			</div>

			{open && (
				<div className="space-y-3 border-t border-border p-3">
					{/* a killed process has no partial results — say so rather than
					    rendering an empty assertion list */}
					{status === "timeout" && assertions.length === 0 && !result?.cases?.length && (
						<p className="text-xs text-warning">
							Timed out after {formatDuration(durationMs)}. A suite killed at its time budget
							reports no assertion detail.
						</p>
					)}
					{/* a route suite is one run: case 0 (#627) */}
					{!result?.cases && (
						<TraceLink
							link={caseTraceLink(traces, 0, traceExpired)}
							failed={status !== "passed"}
							onOpen={onViewTrace}
						/>
					)}
					{result?.debug ? (
						<RunDebugError projectId={projectId} target={target} debug={result.debug} />
					) : (
						result?.error && <p className="text-xs text-danger">{result.error}</p>
					)}
					{result?.teardownError && (
						<p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
							{status === "passed" ? "Passed, but teardown" : "Teardown"} failed:{" "}
							{result.teardownError}. Test data may be left behind.
						</p>
					)}

					<CheckList checks={assertions} />
					{result?.cases && (
						<CaseResults
							cases={result.cases}
							renderDebug={(debug) => (
								<RunDebugError projectId={projectId} target={target} debug={debug} />
							)}
							renderTrace={(c) => (
								<TraceLink
									link={caseTraceLink(traces, c.index, traceExpired)}
									failed={c.status !== "passed"}
									onOpen={onViewTrace}
								/>
							)}
						/>
					)}

					{(result?.actualData !== undefined || result?.headers) && (
						<ResponseViewer data={result?.actualData} headers={result?.headers} suiteName={name} />
					)}
				</div>
			)}
		</div>
	);
}

/** Absolute local time, plus a relative hint for anything recent. */
export function formatWhen(value: unknown) {
	if (!value) return "—";
	const date = new Date(value as string);
	if (Number.isNaN(date.getTime())) return "—";
	const elapsed = Date.now() - date.getTime();
	const minutes = Math.round(elapsed / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
	return date.toLocaleString();
}

function RunHistory({
	projectId,
	target,
	suiteId,
	onSelect,
}: {
	projectId: string;
	target: SuiteTarget;
	/** only runs that included this suite */
	suiteId?: string;
	onSelect: (runId: string) => void;
}) {
	const [page, setPage] = useState(1);
	// "5m ago" is worked out at render; re-render each minute so it keeps moving
	const [, setNow] = useState(0);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);
	const runs = testSuitesQuery.getRuns.useQuery(projectId, target, {
		page,
		perPage: 10,
		suiteId,
	});
	const pagination = runs.data?.pagination;

	if (runs.isLoading) {
		return (
			<div className="flex justify-center p-6">
				<Spinner size="sm" />
			</div>
		);
	}

	const items = runs.data?.data ?? [];
	if (items.length === 0) {
		return <p className="p-6 text-center text-xs text-muted">No runs yet.</p>;
	}

	return (
		<div className="space-y-2 py-3">
			{items.map((run) => (
				<div
					key={run.id}
					role="button"
					tabIndex={0}
					onClick={() => onSelect(run.id)}
					onKeyDown={(e) => e.key === "Enter" && onSelect(run.id)}
					className="flex cursor-pointer flex-col gap-1 rounded-lg border border-border bg-background-secondary p-3 hover:border-accent/40"
				>
					<div className="flex items-center gap-2">
						<StatusIcon status={run.status} />
						<Chip size="sm" color={run.env === "development" ? "accent" : "default"}>
							{run.env === "development" ? "Dev" : "Prod"}
						</Chip>
						{run.deploymentId && (
							<Chip size="sm" title="Ran as part of a promote">
								Promote check
							</Chip>
						)}
						<span className="flex-1 text-xs text-foreground">
							{run.passedCount}/{run.totalSuites} passed
							{run.skippedCount > 0 && `, skipped ${run.skippedCount} disabled`}
						</span>
						<span className="text-xs text-muted">{formatDuration(run.durationMs)}</span>
					</div>
					<span className="pl-6 text-xs text-muted">
						{formatWhen(run.startedAt ?? run.createdAt)}
					</span>
				</div>
			))}

			{pagination && (
				<div className="flex items-center justify-between pt-1">
					<Button
						variant="ghost"
						size="sm"
						isDisabled={page <= 1}
						onPress={() => setPage((p) => p - 1)}
					>
						Previous
					</Button>
					<span className="text-xs text-muted">Page {page}</span>
					<Button
						variant="ghost"
						size="sm"
						isDisabled={!pagination.hasNext}
						onPress={() => setPage((p) => p + 1)}
					>
						Next
					</Button>
				</div>
			)}
		</div>
	);
}

/**
 * The run panel. Suite rows settle independently on the server, so this renders
 * whatever has landed so far rather than one spinner until the parent finishes.
 */
export function RunResults({
	projectId,
	target,
	runId,
	suiteId,
	suiteNames,
	onSelectRun,
	onShownRunChange,
}: {
	projectId: string;
	target: SuiteTarget;
	/** a run started here or linked to; shown until another suite is picked */
	runId: string | null;
	/** the suite picked on the left: only its result and its runs are shown */
	suiteId: string | null;
	suiteNames: Record<string, string>;
	onSelectRun: (runId: string | null) => void;
	/** the run on screen changed: the page keeps it in its URL */
	onShownRunChange?: (runId: string | null) => void;
}) {
	const [view, setView] = useState<"latest" | "history">("latest");
	const [confirmClear, setConfirmClear] = useState(false);
	const [trace, setTrace] = useState<OpenTrace | null>(null);
	// a run started, linked to, or picked from the history beats the suite's latest
	const [pinned, setPinned] = useState<string | null>(runId);
	useEffect(() => {
		if (runId) setPinned(runId);
	}, [runId]);
	// a different suite drops it (not the first pick, which a link may have come with)
	const previousSuite = useRef(suiteId);
	useEffect(() => {
		if (previousSuite.current && previousSuite.current !== suiteId) setPinned(null);
		previousSuite.current = suiteId;
	}, [suiteId]);
	const latest = testSuitesQuery.getRuns.useQuery(projectId, target, {
		page: 1,
		perPage: 5,
		suiteId: suiteId ?? undefined,
	});
	const shownRunId = pinned ?? latest.data?.data[0]?.id ?? null;
	const reportShown = useRef(onShownRunChange);
	reportShown.current = onShownRunChange;
	useEffect(() => {
		reportShown.current?.(shownRunId);
	}, [shownRunId]);
	const run = testSuitesQuery.getRun.useQuery(projectId, target, shownRunId);
	const clear = testSuitesQuery.clearRuns.mutation(projectId, target);
	const data = run.data;
	const summary = data?.result as { error?: string } | null | undefined;
	const suiteRuns = (data?.suiteRuns ?? []).filter((s) => !suiteId || s.testSuiteId === suiteId);
	const skipped = (data?.result as { skipped?: number } | null)?.skipped ?? 0;
	const passed = suiteRuns.filter((s) => s.status === "passed").length;
	const failed = suiteRuns.filter((s) => ["failed", "timeout", "error"].includes(s.status)).length;

	return (
		<aside className="flex w-96 shrink-0 flex-col border-l border-border">
			<Tabs
				variant="secondary"
				selectedKey={view}
				onSelectionChange={(key) => setView(key as "latest" | "history")}
				className="fx-panel__tabs min-h-0 flex-1 p-4"
			>
				<div className="flex items-center gap-2">
					<Tabs.ListContainer className="flex-none">
						<Tabs.List aria-label="Run results view" className="h-full w-auto min-w-0">
							<Tabs.Tab id="latest">
								Latest run
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab id="history">
								Run history
								<Tabs.Indicator />
							</Tabs.Tab>
						</Tabs.List>
					</Tabs.ListContainer>
					{view === "latest" && data && (
						<span className="ml-auto text-xs text-muted">
							{passed} passed · {failed} failed
							{skipped > 0 && ` · ${skipped} disabled skipped`}
						</span>
					)}
					{view === "history" && (
						<DeleteButton
							size="sm"
							className="ml-auto"
							isPending={clear.isPending}
							onPress={() => setConfirmClear(true)}
						>
							Clear
						</DeleteButton>
					)}
				</div>

				<Tabs.Panel id="history" className="min-h-0 flex-1 overflow-y-auto">
					<RunHistory
						key={suiteId}
						projectId={projectId}
						target={target}
						suiteId={suiteId ?? undefined}
						onSelect={(id) => {
							setPinned(id);
							setView("latest");
						}}
					/>
				</Tabs.Panel>
				<Tabs.Panel id="latest" className="min-h-0 flex-1 overflow-y-auto">
					{!shownRunId ? (
						latest.isLoading ? (
							<div className="flex justify-center p-6">
								<Spinner size="sm" />
							</div>
						) : (
							<p className="p-6 text-center text-xs text-muted">
								Run this suite to see its result here.
							</p>
						)
					) : run.isLoading ? (
						<div className="flex justify-center p-6">
							<Spinner size="sm" />
						</div>
					) : (
						<div className="space-y-2 py-3">
							{/* a run can fail outright — compilation error, or a restart
						    mid-run — with no suite detail at all */}
							{data?.status === "error" && (
								<div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
									{summary?.error ?? "The run failed before any suite reported."}
								</div>
							)}
							{suiteRuns.map((suiteRun) => (
								<SuiteRunRow
									key={suiteRun.id}
									projectId={projectId}
									target={target}
									name={suiteNames[suiteRun.testSuiteId] ?? "Suite"}
									status={suiteRun.status}
									durationMs={suiteRun.durationMs}
									result={suiteRun.result as SuiteRunResult | null}
									traces={suiteRun.traces}
									traceExpired={Boolean(data?.traceExpired)}
									onViewTrace={setTrace}
								/>
							))}
							{data && suiteRuns.length === 0 && data.status !== "error" && (
								<p className="p-6 text-center text-xs text-muted">
									{data.suiteRuns.length > 0
										? "This suite was not part of this run."
										: "Waiting for the first suite to settle…"}
								</p>
							)}
						</div>
					)}
				</Tabs.Panel>
			</Tabs>

			{/* which run this is, in the panel's bottom-right corner */}
			{view === "latest" && data && (
				<div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2">
					<Chip size="sm" color={data.env === "development" ? "accent" : "default"}>
						{data.env === "development" ? "Dev" : "Prod"}
					</Chip>
					{data.deploymentId && (
						<Chip size="sm" title="Ran as part of a promote">
							Promote check
						</Chip>
					)}
					<Chip size="sm">
						<TbClock size={13} />
						{formatDuration(data.durationMs)} · {formatWhen(data.startedAt ?? data.createdAt)}
					</Chip>
				</div>
			)}

			<TestTraceModal
				projectId={projectId}
				target={target}
				trace={trace}
				onClose={() => setTrace(null)}
			/>
			<ConfirmDialog
				open={confirmClear}
				onOpenChange={setConfirmClear}
				title="Clear run history"
				confirmText="Clear"
				danger
				pending={clear.isPending}
				onConfirm={() =>
					clear.mutate(undefined, {
						onSuccess: () => {
							setConfirmClear(false);
							// the shown run was just deleted too
							setPinned(null);
							onSelectRun(null);
						},
						onError: (error) => showErrorNotification(error as Error),
					})
				}
			>
				Every recorded run for this {target.type} will be deleted. The suites themselves are kept.
			</ConfirmDialog>
		</aside>
	);
}
