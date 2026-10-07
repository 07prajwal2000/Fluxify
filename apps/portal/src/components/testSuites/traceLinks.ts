import { spansAt } from "@/components/recordings/spans";
import type { RecordedSpan } from "@/services/recordings";

/** one case's trace, as a test run's results list it (#627) */
export type CaseTrace = { caseIndex: number; traceRunId: string };

/**
 * What a case's "View trace" shows: the trace to open, "expired" once the run is
 * past the recording max age, or nothing (an older run, or a trace not yet stored).
 */
export function caseTraceLink(
	traces: CaseTrace[] | undefined,
	caseIndex: number,
	expired: boolean,
): { traceRunId: string } | "expired" | null {
	const found = traces?.find((trace) => trace.caseIndex === caseIndex);
	if (found) return { traceRunId: found.traceRunId };
	return expired ? "expired" : null;
}

/** the block a failed run failed in, on its own canvas, so the viewer opens on it */
export const failingBlock = (spans: RecordedSpan[]) =>
	spansAt(spans, null).find((span) => span.outcome === "failure")?.blockId ?? null;
