import { Link, useParams } from "@tanstack/react-router";
import { TbPlayerPlay } from "react-icons/tb";
import { CHIP } from "../AgentRef";
import type { ToolPart } from "../agentMessages";
import { isRec, rec, str } from "./data";

const OUTCOME: Record<string, string> = { success: "text-success", failure: "text-danger" };

const when = (v: unknown) => {
	const d = new Date(str(v));
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};
const took = (ms: unknown) =>
	typeof ms !== "number" ? "" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

/** A recorded run opens on its target's executions page, in a new tab. Nothing without a full address. */
export function OpenRecording({
	kind,
	targetId,
	runId,
}: {
	kind: string;
	targetId: string;
	runId: string;
}) {
	const { projectId } = useParams({ strict: false }) as { projectId?: string };
	if (!projectId || !targetId || !runId || (kind !== "route" && kind !== "workflow")) return null;
	const to: string = `/${projectId}/${kind === "route" ? "canvas" : "workflow-canvas"}/${targetId}/executions`;
	return (
		<Link
			to={to}
			search={{ open: runId } as never}
			target="_blank"
			rel="noopener noreferrer"
			className={`${CHIP} no-underline transition-colors hover:bg-accent/20`}
			title="Open this recording in a new tab"
		>
			<TbPlayerPlay size={13} className="shrink-0" />
			<span>Open recording</span>
		</Link>
	);
}

/** What happened in a run, in a line: time, outcome, status code, how long. */
function Facts({ run }: { run: Record<string, unknown> }) {
	const outcome = str(run.outcome);
	return (
		<>
			<span className="text-foreground">{when(run.startedAt)}</span>
			{outcome && <span className={OUTCOME[outcome] ?? "text-muted"}>{outcome}</span>}
			{run.statusCode !== undefined && run.statusCode !== null && (
				<span className="font-mono text-muted">{str(run.statusCode)}</span>
			)}
			{took(run.durationMs) && <span className="text-muted">{took(run.durationMs)}</span>}
		</>
	);
}

/** list_recordings: one line per run, with a link that opens it instead of its id. */
export function RecordingList({ tool }: { tool: ToolPart }) {
	const input = rec(tool.input);
	const items = isRec(tool.output) && Array.isArray(tool.output.items) ? tool.output.items : [];
	if (!items.length) return <p className="text-xs text-muted">No recorded runs.</p>;
	return (
		<div className="flex flex-col gap-1">
			<ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs marker:text-muted">
				{items.map((r) => {
					const run = rec(r);
					return (
						<li key={str(run.id)}>
							<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
								<Facts run={run} />
								{run.testLabel ? (
									<span className="text-muted">test: {str(run.testLabel)}</span>
								) : null}
								<OpenRecording
									kind={str(input.kind)}
									targetId={str(input.targetId)}
									runId={str(run.id)}
								/>
							</span>
						</li>
					);
				})}
			</ul>
			{isRec(tool.output) && tool.output.hasNext === true && (
				<p className="text-xs text-muted">More runs on the next page.</p>
			)}
		</div>
	);
}

/** get_recording: the run in a line and the button that opens it; its spans are for the agent. */
export function RecordingSummary({ tool }: { tool: ToolPart }) {
	const input = rec(tool.input);
	const run = rec(tool.output);
	return (
		<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
			<Facts run={run} />
			{Array.isArray(run.spans) && (
				<span className="text-muted">{run.spans.length} blocks ran</span>
			)}
			<OpenRecording
				kind={str(input.kind)}
				targetId={str(input.targetId)}
				runId={str(input.runId) || str(run.id)}
			/>
		</p>
	);
}

/** A run read in full has a list of spans; one span (by `spanSeq`) does not. */
export const isRun = (output: unknown) => isRec(output) && Array.isArray(output.spans);
