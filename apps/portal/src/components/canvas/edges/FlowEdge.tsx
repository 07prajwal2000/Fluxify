import { BaseEdge, EdgeLabelRenderer, type EdgeProps, useReactFlow, useStore } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TbPlus, TbX } from "react-icons/tb";
import { useCanvasLayoutLocked } from "../CanvasLayoutLockContext";
import { useCanvasReadOnly } from "../CanvasReadOnlyContext";
import { useQuickAdd } from "../QuickAddContext";
import type { BlockEdge } from "../types";
import type { Rect } from "./edgeRouting";
import { decodeRects, encodeRects, routeEdge } from "./edgeRouting";
import "./edges.css";

/** How far past the two handles to look for blocks the route must avoid. */
const ROUTE_MARGIN = 240;

/**
 * The canvas edge: dashes flow from source to target. Hovering the line itself
 * or selecting it reveals delete and insert buttons sitting on the path (React
 * Flow's label coordinates are the curve's midpoint, not the bounding box centre).
 */
export function FlowEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	selected,
	markerEnd,
	style,
	data,
}: EdgeProps<BlockEdge>) {
	const { deleteElements } = useReactFlow();
	const quickAdd = useQuickAdd();
	// Hover is the line (or its buttons), not a box around it, so edges in a
	// crowded area never compete for the pointer. The short delay lets the pointer
	// cross from the line onto the buttons.
	const [hovered, setHovered] = useState(false);
	const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const hoverProps = {
		onPointerEnter: () => {
			clearTimeout(leaveTimer.current);
			setHovered(true);
		},
		onPointerLeave: () => {
			leaveTimer.current = setTimeout(() => setHovered(false), 120);
		},
	};
	useEffect(() => () => clearTimeout(leaveTimer.current), []);
	const readOnly = useCanvasReadOnly();
	const layoutLocked = useCanvasLayoutLocked();
	const canEdit = !readOnly && !layoutLocked;
	// Scale that grows at half the zoom rate (sqrt): buttons and hit strip stay
	// usable zoomed out without ballooning zoomed in.
	const soften = useStore((state) => 1 / Math.sqrt(state.transform[2]));
	// Only blocks near this edge can be in its way; the key is a string so the
	// edge re-renders when one of them moves, not on every canvas change.
	const nearby = useStore((state) => {
		const x1 = Math.min(sourceX, targetX) - ROUTE_MARGIN;
		const x2 = Math.max(sourceX, targetX) + ROUTE_MARGIN;
		const y1 = Math.min(sourceY, targetY) - ROUTE_MARGIN;
		const y2 = Math.max(sourceY, targetY) + ROUTE_MARGIN;
		const rects: Rect[] = [];
		for (const node of state.nodeLookup.values()) {
			const { x, y } = node.internals.positionAbsolute;
			const w = node.measured.width ?? 0;
			const h = node.measured.height ?? 0;
			if (x < x2 && x + w > x1 && y < y2 && y + h > y1) {
				rects.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
			}
		}
		return encodeRects(rects);
	});
	const { path, labelX, labelY } = useMemo(
		() =>
			routeEdge(
				{ x: sourceX, y: sourceY, position: sourcePosition },
				{ x: targetX, y: targetY, position: targetPosition },
				decodeRects(nearby),
			),
		[sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, nearby],
	);
	const edgeClassName = [
		"fx-edge",
		selected && "fx-edge--selected",
		data?.cycle && "fx-edge--cycle",
		data?.cycleFlash && "fx-edge--cycle-flash",
	]
		.filter(Boolean)
		.join(" ");

	// deleteElements (not setEdges) so the removal reaches onEdgesChange.
	const remove = useCallback(() => {
		if (!canEdit) return;
		void deleteElements({ edges: [{ id }] });
	}, [canEdit, deleteElements, id]);

	return (
		<>
			{/* React Flow's own wide invisible path (interactionWidth) sits above the line, so hover must be read from the group, not from a path of ours. */}
			<g {...hoverProps}>
				<BaseEdge
					id={id}
					path={path}
					markerEnd={markerEnd}
					style={style}
					className={edgeClassName}
					interactionWidth={28 * soften}
				/>
			</g>
			{canEdit && (selected || hovered) && (
				<EdgeLabelRenderer>
					<div
						className="fx-edge__actions"
						{...hoverProps}
						style={{
							transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${soften})`,
						}}
					>
						<button
							type="button"
							className="fx-edge__delete"
							title="Delete connection"
							aria-label="Delete connection"
							onClick={remove}
						>
							<TbX size={13} />
						</button>
						{quickAdd && (
							<button
								type="button"
								className="fx-edge__insert"
								title="Insert a block"
								aria-label="Insert a block"
								onClick={() => quickAdd({ kind: "edge", edgeId: id })}
							>
								<TbPlus size={13} />
							</button>
						)}
					</div>
				</EdgeLabelRenderer>
			)}
		</>
	);
}
