import type { CanvasEdge } from "@/components/canvas/types";
import type { RecordedRunSummary, RecordedSpan } from "@/services/recordings";

/**
 * One canvas level of a recording: the spans hanging directly off `parentSeq`
 * (null = the run's own level). A custom block call opens the level under its
 * span; an async call opens another run at its root.
 */
export type Frame = {
	runId: string;
	parentSeq: number | null;
	/** whose canvas to draw; null = the route's or workflow's own */
	customBlockId: string | null;
	label: string;
};

/** cut to fit, spans dropped, or never finished: what is shown is not the whole run */
export const isIncomplete = (
	run: Pick<RecordedRunSummary, "truncated" | "droppedSpans" | "durationMs">,
) => run.truncated || run.droppedSpans > 0 || run.durationMs === null;

export const spanMs = (span: Pick<RecordedSpan, "startedAt" | "endedAt">) =>
	Date.parse(span.endedAt) - Date.parse(span.startedAt);

export const spansAt = (spans: RecordedSpan[], parentSeq: number | null) =>
	spans.filter((span) => (span.parentSeq ?? null) === parentSeq);

/**
 * The custom block a span called, read off the spans recorded inside the call.
 * A middleware's span has steps under it but no canvas, so it has none.
 */
export const calledBlockId = (spans: RecordedSpan[], span: RecordedSpan) =>
	spans.find((child) => child.parentSeq === span.seq && child.customBlockId)?.customBlockId ?? null;

/** an async run's root spans sit in the custom block it ran; a normal run's in neither */
export const rootCanvasId = (spans: RecordedSpan[]) =>
	spans.find((span) => span.parentSeq == null && span.customBlockId)?.customBlockId ?? null;

/** per block on this level: `true` passed, `false` failed (any of its runs); absent = did not run */
export function blockStatuses(level: RecordedSpan[]) {
	const status: Record<string, boolean> = {};
	for (const span of level) {
		status[span.blockId] = (status[span.blockId] ?? true) && span.outcome === "success";
	}
	return status;
}

/**
 * Edges the run went through: both ends ran, and a condition block left
 * through the handle its `branch` names (`success` / `failure`).
 */
export function takenEdgeIds(edges: CanvasEdge[], level: RecordedSpan[]) {
	const byBlock = new Map<string, RecordedSpan[]>();
	for (const span of level) byBlock.set(span.blockId, [...(byBlock.get(span.blockId) ?? []), span]);
	return edges
		.filter((edge) => {
			const from = byBlock.get(edge.from);
			if (!from || !byBlock.has(edge.to)) return false;
			return from.some((span) => !span.branch || span.branch === edge.fromHandle);
		})
		.map((edge) => edge.id);
}
