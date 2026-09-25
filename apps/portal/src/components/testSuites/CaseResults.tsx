import { CodeViewer, cn } from "@fluxify/components";
import type { AssertionResult, CaseResult } from "@fluxify/server/src/db/schema";
import { useState } from "react";
import { TbAlertTriangle, TbCheck, TbChevronDown, TbChevronRight, TbX } from "react-icons/tb";

export function formatDuration(ms: number | null | undefined) {
	if (ms == null) return "—";
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

/** one line per check: an assertion, or a `t.expect` from a hook or custom JS */
export function CheckList({ checks }: { checks: AssertionResult[] }) {
	if (checks.length === 0) return null;
	return (
		<ul className="space-y-1">
			{checks.map((check, index) => (
				<li
					// eslint-disable-next-line react/no-array-index-key -- verdicts are positional
					key={index}
					className="flex items-start gap-2 text-xs"
				>
					{check.success ? (
						<TbCheck size={14} className="mt-0.5 shrink-0 text-success" />
					) : (
						<TbX size={14} className="mt-0.5 shrink-0 text-danger" />
					)}
					<span className={check.success ? "text-muted" : "text-foreground"}>{check.message}</span>
				</li>
			))}
		</ul>
	);
}

function CaseRow({ result }: { result: CaseResult }) {
	// failures open by default: they are what a reader came for
	const [open, setOpen] = useState(result.status !== "passed");
	const failed = result.status !== "passed";

	return (
		<div className="rounded-md border border-border">
			<div
				role="button"
				tabIndex={0}
				onClick={() => setOpen((v) => !v)}
				onKeyDown={(e) => e.key === "Enter" && setOpen((v) => !v)}
				className="flex cursor-pointer items-center gap-2 px-2 py-1.5"
			>
				{result.status === "passed" ? (
					<TbCheck size={14} className="shrink-0 text-success" />
				) : result.status === "timeout" ? (
					<TbAlertTriangle size={14} className="shrink-0 text-warning" />
				) : (
					<TbX size={14} className="shrink-0 text-danger" />
				)}
				<span className={cn("min-w-0 flex-1 truncate text-xs", failed && "text-foreground")}>
					{result.name}
				</span>
				<span className="text-xs text-muted">{formatDuration(result.durationMs)}</span>
				{open ? (
					<TbChevronDown size={14} className="text-muted" />
				) : (
					<TbChevronRight size={14} className="text-muted" />
				)}
			</div>
			{open && (
				<div className="space-y-2 border-t border-border p-2">
					{result.error && <p className="text-xs text-danger">{result.error}</p>}
					<CheckList checks={result.checks} />
					<CodeViewer
						language="json"
						value={JSON.stringify({ input: result.input, result: result.output }, null, 2)}
					/>
				</div>
			)}
		</div>
	);
}

/**
 * A workflow suite's cases (#487), failures first. Every case is stored raw, so
 * this view is only one way to read them.
 */
export function CaseResults({ cases }: { cases: CaseResult[] }) {
	const passed = cases.filter((c) => c.status === "passed").length;
	const ordered = [...cases].sort(
		(a, b) => Number(a.status === "passed") - Number(b.status === "passed") || a.index - b.index,
	);
	return (
		<div className="space-y-1">
			<p className="text-xs text-muted">
				{passed} of {cases.length} case{cases.length === 1 ? "" : "s"} passed
			</p>
			{ordered.map((result) => (
				<CaseRow key={result.index} result={result} />
			))}
		</div>
	);
}
