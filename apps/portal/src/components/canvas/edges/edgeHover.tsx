import { type InternalNode, useReactFlow } from "@xyflow/react";
import {
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useState,
} from "react";

type Box = { x1: number; y1: number; x2: number; y2: number };

/** Padding (flow px) around an edge's handle-to-handle box. */
const PAD = 40;

/** Box between an edge's two handle points, padded. */
export function pointsBox(a: { x: number; y: number }, b: { x: number; y: number }): Box {
	return {
		x1: Math.min(a.x, b.x) - PAD,
		y1: Math.min(a.y, b.y) - PAD,
		x2: Math.max(a.x, b.x) + PAD,
		y2: Math.max(a.y, b.y) + PAD,
	};
}

/** Centre of a handle on the canvas, or null before React Flow measured it. */
function handlePoint(node: InternalNode, type: "source" | "target", id: string | null | undefined) {
	const handle = node.internals.handleBounds?.[type]?.find((item) => item.id === id);
	if (!handle) return null;
	const { x, y } = node.internals.positionAbsolute;
	return { x: x + handle.x + handle.width / 2, y: y + handle.y + handle.height / 2 };
}

/** Innermost box holding the point wins, so nested connections stay reachable. */
export function pickEdge(point: { x: number; y: number }, boxes: [string, Box][]): string | null {
	let best: string | null = null;
	let bestArea = Number.POSITIVE_INFINITY;
	for (const [id, box] of boxes) {
		if (point.x < box.x1 || point.x > box.x2 || point.y < box.y1 || point.y > box.y2) continue;
		const area = (box.x2 - box.x1) * (box.y2 - box.y1);
		if (area < bestArea) {
			best = id;
			bestArea = area;
		}
	}
	return best;
}

const HoveredEdge = createContext<string | null>(null);
export const useHoveredEdge = () => useContext(HoveredEdge);

/**
 * Which edge's box the pointer is in. Tracked from pointer moves rather than an
 * invisible box on the canvas, which would swallow clicks and drags on the pane.
 */
export function useEdgeHover(rootRef: RefObject<HTMLElement | null>): string | null {
	const { getEdges, getInternalNode, screenToFlowPosition } = useReactFlow();
	const [hovered, setHovered] = useState<string | null>(null);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		// Handle to handle, padded: the space the curve runs through, whichever
		// sides the handles sit on.
		const boxOf = (edge: {
			source: string;
			target: string;
			sourceHandle?: string | null;
			targetHandle?: string | null;
		}): Box | null => {
			const from = getInternalNode(edge.source);
			const to = getInternalNode(edge.target);
			const a = from && handlePoint(from, "source", edge.sourceHandle);
			const b = to && handlePoint(to, "target", edge.targetHandle);
			return a && b ? pointsBox(a, b) : null;
		};
		// ponytail: scans every edge per move; index boxes if graphs grow to thousands of edges.
		const onMove = (event: PointerEvent) => {
			const boxes: [string, Box][] = [];
			for (const edge of getEdges()) {
				const box = boxOf(edge);
				if (box) boxes.push([edge.id, box]);
			}
			setHovered(pickEdge(screenToFlowPosition({ x: event.clientX, y: event.clientY }), boxes));
		};
		const onLeave = () => setHovered(null);
		root.addEventListener("pointermove", onMove);
		root.addEventListener("pointerleave", onLeave);
		return () => {
			root.removeEventListener("pointermove", onMove);
			root.removeEventListener("pointerleave", onLeave);
		};
	}, [rootRef, getEdges, getInternalNode, screenToFlowPosition]);

	return hovered;
}

export function EdgeHoverProvider({
	rootRef,
	children,
}: {
	rootRef: RefObject<HTMLElement | null>;
	children: ReactNode;
}) {
	return <HoveredEdge.Provider value={useEdgeHover(rootRef)}>{children}</HoveredEdge.Provider>;
}
