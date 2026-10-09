import { TbCheck, TbX } from "react-icons/tb";
import { AgentRef } from "../AgentRef";
import type { ToolPart } from "../agentMessages";
import { fmtDuration } from "../runChanges";
import { type Data, isRec, rec, str } from "./data";
import { Notice } from "./Notice";

const list = (v: unknown) => (Array.isArray(v) ? v : []);

/** One case: passed or failed, and for a failure each check that did not hold with the value it got. */
function Case({ c }: { c: Data }) {
	const passed = c.status === "passed";
	const checks = list(c.failedChecks).map(str);
	return (
		<li className="flex flex-col gap-1 py-1.5">
			<div className="flex items-center gap-2">
				{passed ? (
					<TbCheck size={14} aria-label="passed" className="shrink-0 text-success" />
				) : (
					<TbX size={14} aria-label="failed" className="shrink-0 text-danger" />
				)}
				<span className="font-medium text-foreground">{str(c.name) || "request"}</span>
				{c.statusCode !== undefined && <span className="text-muted">{str(c.statusCode)}</span>}
				{passed && <span className="text-muted">all checks passed</span>}
			</div>
			{c.error ? (
				<Notice tone="danger">{isRec(c.error) ? str(rec(c.error).message) : str(c.error)}</Notice>
			) : null}
			{checks.map((m) => (
				<p
					key={m}
					className="ml-6 break-words rounded bg-danger/10 px-2 py-0.5 font-mono text-danger"
				>
					{m}
				</p>
			))}
		</li>
	);
}

function Suite({ s }: { s: Data }) {
	return (
		<section className="flex flex-col gap-1 rounded-lg border border-border p-2">
			<header className="flex items-center gap-2">
				<AgentRef type="test_suite" id={str(s.testSuiteId)}>
					Test suite
				</AgentRef>
				<span className="text-muted">{str(s.status)}</span>
				{typeof s.durationMs === "number" && (
					<span className="text-muted">{fmtDuration(s.durationMs)}</span>
				)}
			</header>
			<ul className="flex flex-col divide-y divide-border">
				{list(s.cases).map((c, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: cases keep their order
					<Case key={i} c={rec(c)} />
				))}
			</ul>
			{s.teardownError ? (
				<Notice tone="warning">Teardown failed: {str(s.teardownError)}</Notice>
			) : null}
		</section>
	);
}

function Run({ run }: { run: Data }) {
	return (
		<div className="flex flex-col gap-2">
			<p className="flex flex-wrap items-center gap-2 text-sm">
				<span className="font-medium text-foreground">{str(run.status)}</span>
				{run.passedCount !== undefined && (
					<span className="text-success">{str(run.passedCount)} passed</span>
				)}
				{run.failedCount !== undefined && (
					<span className={Number(run.failedCount) ? "text-danger" : "text-muted"}>
						{str(run.failedCount)} failed
					</span>
				)}
				{typeof run.durationMs === "number" && (
					<span className="text-muted">{fmtDuration(run.durationMs)}</span>
				)}
			</p>
			{run.message ? <Notice>{str(run.message)}</Notice> : null}
			{list(run.suites).map((s) => (
				<Suite key={str(rec(s).testSuiteId)} s={rec(s)} />
			))}
		</div>
	);
}

/** run_test_suite and get_test_runs: every case pass or fail, with the checks that failed and what they got. */
export function TestRunPreview({ tool }: { tool: ToolPart }) {
	const runs = Array.isArray(tool.output) ? tool.output : isRec(tool.output) ? [tool.output] : [];
	const suiteId = str(rec(tool.input).testSuiteId);
	if (!runs.length)
		return (
			<p className="flex items-center gap-2 text-xs text-muted">
				{tool.name === "run_test_suite" ? "Runs" : "Reads the runs of"}
				{suiteId && (
					<AgentRef type="test_suite" id={suiteId}>
						Test suite
					</AgentRef>
				)}
				{tool.name === "run_test_suite" &&
					"for real: setup hooks, requests and workflow runs all happen."}
			</p>
		);
	return (
		<div className="flex flex-col gap-3 text-xs">
			{runs.map((r, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: runs keep their order
				<Run key={str(rec(r).runId) || i} run={rec(r)} />
			))}
		</div>
	);
}
