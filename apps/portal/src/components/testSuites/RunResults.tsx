import { useState } from "react";
import { Button, DeleteButton, Spinner, Tabs, cn } from "@fluxify/components";
import type { SuiteRunResult } from "@fluxify/server/src/db/schema";
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
import type { TestRunStatus } from "@/services/testSuites";
import { ResponseViewer } from "./ResponseViewer";

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
	if (status === "failed" || status === "error")
		return <TbX size={15} className={className} />;
	if (status === "timeout")
		return <TbAlertTriangle size={15} className={className} />;
	return <TbClock size={15} className={cn(className, "animate-pulse")} />;
}

function formatDuration(ms: number | null | undefined) {
	if (ms == null) return "—";
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function SuiteRunRow({
	name,
	status,
	durationMs,
	result,
}: {
	name: string;
	status: TestRunStatus;
	durationMs: number | null;
	result: SuiteRunResult | null;
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
				<span className="min-w-0 flex-1 truncate text-xs text-foreground">
					{name}
				</span>
				{result?.statusCode != null && (
					<span className="font-mono text-xs text-muted">
						{result.statusCode}
					</span>
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
					{status === "timeout" && assertions.length === 0 && (
						<p className="text-xs text-warning">
							Timed out after {formatDuration(durationMs)}. A suite killed at
							its time budget reports no assertion detail.
						</p>
					)}
					{result?.error && (
						<p className="text-xs text-danger">{result.error}</p>
					)}

					{assertions.length > 0 && (
						<ul className="space-y-1">
							{assertions.map((assertion, index) => (
								<li
									// eslint-disable-next-line react/no-array-index-key -- verdicts are positional
									key={index}
									className="flex items-start gap-2 text-xs"
								>
									{assertion.success ? (
										<TbCheck
											size={14}
											className="mt-0.5 shrink-0 text-success"
										/>
									) : (
										<TbX size={14} className="mt-0.5 shrink-0 text-danger" />
									)}
									<span
										className={
											assertion.success ? "text-muted" : "text-foreground"
										}
									>
										{assertion.message}
									</span>
								</li>
							))}
						</ul>
					)}

					{(result?.actualData !== undefined || result?.headers) && (
						<ResponseViewer
							data={result?.actualData}
							headers={result?.headers}
							suiteName={name}
						/>
					)}
				</div>
			)}
		</div>
	);
}

/** Absolute local time, plus a relative hint for anything recent. */
function formatWhen(value: unknown) {
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
	routeId,
	onSelect,
}: {
	projectId: string;
	routeId: string;
	onSelect: (runId: string) => void;
}) {
	const [page, setPage] = useState(1);
	const runs = testSuitesQuery.getRuns.useQuery(projectId, routeId, {
		page,
		perPage: 10,
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
		<div className="space-y-2 p-3">
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
						<span className="flex-1 text-xs text-foreground">
							{run.passedCount}/{run.totalSuites} passed
						</span>
						<span className="text-xs text-muted">
							{formatDuration(run.durationMs)}
						</span>
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
	routeId,
	runId,
	suiteNames,
	onSelectRun,
}: {
	projectId: string;
	routeId: string;
	runId: string | null;
	suiteNames: Record<string, string>;
	onSelectRun: (runId: string) => void;
}) {
	const [view, setView] = useState<"latest" | "history">("latest");
	const [confirmClear, setConfirmClear] = useState(false);
	const run = testSuitesQuery.getRun.useQuery(projectId, routeId, runId);
	const clear = testSuitesQuery.clearRuns.mutation(projectId, routeId);
	const data = run.data;
	const summary = data?.result as { error?: string } | null | undefined;

	return (
		<aside className="flex w-96 shrink-0 flex-col border-l border-border">
			<Tabs
				variant="secondary"
				selectedKey={view}
				onSelectionChange={(key) => setView(key as "latest" | "history")}
				className="fx-panel__tabs p-4"
			>
				<div className="flex items-center gap-2">
					<Tabs.ListContainer className="flex-none">
						<Tabs.List
							aria-label="Run results view"
							className="h-full w-auto min-w-0"
						>
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
						<>
							<span className="ml-auto text-xs text-muted">
								{data.passedCount} passed · {data.failedCount} failed
							</span>
							<span className="flex items-center gap-1 text-xs text-muted">
								<TbClock size={14} /> {formatDuration(data.durationMs)} ·{" "}
								{formatWhen(data.startedAt ?? data.createdAt)}
							</span>
						</>
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
						projectId={projectId}
						routeId={routeId}
						onSelect={(id) => {
							onSelectRun(id);
							setView("latest");
						}}
					/>
				</Tabs.Panel>
				<Tabs.Panel id="latest" className="min-h-0 flex-1 overflow-y-auto">
					{!runId ? (
						<p className="p-6 text-center text-xs text-muted">
							Run a suite to see its result here.
						</p>
					) : run.isLoading ? (
						<div className="flex justify-center p-6">
							<Spinner size="sm" />
						</div>
					) : (
						<div className="space-y-2 p-3">
							{/* a run can fail outright — compilation error, or a restart
						    mid-run — with no suite detail at all */}
							{data?.status === "error" && (
								<div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
									{summary?.error ??
										"The run failed before any suite reported."}
								</div>
							)}
							{data?.suiteRuns.map((suiteRun) => (
								<SuiteRunRow
									key={suiteRun.id}
									name={suiteNames[suiteRun.testSuiteId] ?? "Suite"}
									status={suiteRun.status}
									durationMs={suiteRun.durationMs}
									result={suiteRun.result as SuiteRunResult | null}
								/>
							))}
							{data?.suiteRuns.length === 0 && data.status !== "error" && (
								<p className="p-6 text-center text-xs text-muted">
									Waiting for the first suite to settle…
								</p>
							)}
						</div>
					)}
				</Tabs.Panel>
			</Tabs>

			<ConfirmDialog
				open={confirmClear}
				onOpenChange={setConfirmClear}
				title="Clear run history"
				confirmText="Clear"
				danger
				pending={clear.isPending}
				onConfirm={() =>
					clear.mutate(undefined, {
						onSuccess: () => setConfirmClear(false),
						onError: (error) => showErrorNotification(error as Error),
					})
				}
			>
				Every recorded run for this route will be deleted. The suites themselves
				are kept.
			</ConfirmDialog>
		</aside>
	);
}
