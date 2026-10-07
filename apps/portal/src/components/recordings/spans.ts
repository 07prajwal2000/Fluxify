import type { CanvasBlock, CanvasEdge, CanvasGraph } from "@/components/canvas/types";
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

/** a persisted handle id is `<blockId>-<kind>`; the kind is what the compiler routes by */
const handleKind = (handle: string) => handle.slice(handle.lastIndexOf("-") + 1);

/**
 * Edges the run went through: both ends ran, and the source left through that
 * handle. A condition block's `branch` picks `success` / `failure`, a Switch's
 * recorded `next` picks its case. Body handles (loop / retry `executor`,
 * Parallel `orchestrate`) and plain `source` only need both ends to have run.
 */
export function takenEdgeIds(edges: CanvasEdge[], level: RecordedSpan[]) {
	const byBlock = new Map<string, RecordedSpan[]>();
	for (const span of level) byBlock.set(span.blockId, [...(byBlock.get(span.blockId) ?? []), span]);
	return edges
		.filter((edge) => {
			const from = byBlock.get(edge.from);
			if (!from || !byBlock.has(edge.to)) return false;
			const kind = handleKind(edge.fromHandle);
			return from.some((span) => {
				if ((kind === "success" || kind === "failure") && span.branch) return span.branch === kind;
				if (kind === "case" && span.metadata?.next) return span.metadata.next === edge.to;
				return true;
			});
		})
		.map((edge) => edge.id);
}

/** the node type a block deleted since the run is drawn as */
export const GHOST_NODE_TYPE = "fx-run-ghost";

/**
 * The saved canvas tinted by what ran, plus a ghost for each block that ran
 * but is gone from the canvas, at the position its span recorded (#628).
 * Spans recorded before positions were (and middlewares, which have no
 * canvas) cannot be drawn; `lost` counts the former.
 */
export function overlayGraph(saved: CanvasGraph, level: RecordedSpan[]) {
	const status = blockStatuses(level);
	const onCanvas = new Set(saved.blocks.map((block) => block.id));
	const ghosts = new Map<string, CanvasBlock>();
	let lost = 0;
	for (const span of level) {
		if (span.middleware || onCanvas.has(span.blockId) || ghosts.has(span.blockId)) continue;
		const position = span.metadata?.position;
		if (!position) {
			lost++;
			continue;
		}
		ghosts.set(span.blockId, {
			id: span.blockId,
			type: GHOST_NODE_TYPE,
			position,
			data: { blockType: span.blockType, blockName: span.blockName, status: status[span.blockId] },
		});
	}
	return {
		graph: {
			blocks: [
				...saved.blocks.map((block) =>
					block.id in status
						? { ...block, data: { ...block.data, status: status[block.id] } }
						: block,
				),
				...ghosts.values(),
			],
			edges: saved.edges,
		},
		lost,
	};
}
