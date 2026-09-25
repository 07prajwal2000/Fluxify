import { type FinalConnectionState, useReactFlow } from "@xyflow/react";
import { type RefObject, useCallback, useRef } from "react";
import type { HandleKind } from "./blocks/handles/handleConfig";
import type { CanvasChanges } from "./changes";
import type { CanvasHistory } from "./history";
import { acceptsMore, applyQuickAdd, type QuickAddContext, quickAdd } from "./quickAdd";
import type { BlockEdge, BlockNode } from "./types";

/** Pointer travel (px) under which a handle drag counts as a click. */
const CLICK_SLOP = 5;

function pointerOf(event: MouseEvent | TouchEvent) {
	const point = "changedTouches" in event ? event.changedTouches[0] : event;
	return { x: point.clientX, y: point.clientY };
}

/**
 * A drag from an output released on empty canvas opens the picker, and the
 * picked block lands at the release point, connected. A drag shorter than
 * CLICK_SLOP is really a click, so the block gets auto-placed instead.
 * Releasing on a handle is a plain connection and never reaches here.
 */
export function useConnectToPicker({
	enabled,
	getEdges,
	openPickerFor,
}: {
	enabled: boolean;
	getEdges: () => BlockEdge[];
	openPickerFor: (context: QuickAddContext) => void;
}) {
	const { screenToFlowPosition } = useReactFlow();
	const start = useRef<{ x: number; y: number } | null>(null);

	const onConnectStart = useCallback((event: MouseEvent | TouchEvent) => {
		start.current = pointerOf(event);
	}, []);

	const onConnectEnd = useCallback(
		(event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
			const from = state.fromHandle;
			const begin = start.current;
			start.current = null;
			if (!enabled || !begin || state.isValid || state.toHandle) return;
			if (!from?.id || from.type !== "source") return;
			const handle = from.id.slice(from.nodeId.length + 1) as HandleKind;
			const used = getEdges().filter((edge) => edge.sourceHandle === from.id).length;
			if (!acceptsMore(handle, used)) return;
			const end = pointerOf(event);
			const moved = Math.hypot(end.x - begin.x, end.y - begin.y) > CLICK_SLOP;
			openPickerFor({
				kind: "handle",
				nodeId: from.nodeId,
				handle,
				at: moved ? screenToFlowPosition(end) : undefined,
			});
		},
		[enabled, getEdges, openPickerFor, screenToFlowPosition],
	);

	return { onConnectStart, onConnectEnd };
}

/**
 * Add + connect (or split an edge) as a single undo step — the plain add and
 * connect paths would each commit their own.
 */
export function useApplyQuickAdd({
	latest,
	pendingEmit,
	history,
	tracker,
	setNodes,
	setEdges,
}: {
	latest: RefObject<{ nodes: BlockNode[]; edges: BlockEdge[] }>;
	pendingEmit: RefObject<boolean>;
	history: CanvasHistory;
	tracker: Pick<CanvasChanges, "markUpserted" | "markDeleted">;
	setNodes: (nodes: BlockNode[]) => void;
	setEdges: (edges: BlockEdge[]) => void;
}) {
	return useCallback(
		(node: BlockNode, context: QuickAddContext) => {
			const result = quickAdd(latest.current.nodes, latest.current.edges, context, node);
			if (!result) return;
			pendingEmit.current = true;
			applyQuickAdd(result, {
				commit: history.commit,
				markUpserted: tracker.markUpserted,
				markDeleted: tracker.markDeleted,
				setGraph: (nextNodes, nextEdges) => {
					setNodes(nextNodes);
					setEdges(nextEdges);
				},
			});
		},
		[latest, pendingEmit, history, tracker, setNodes, setEdges],
	);
}
