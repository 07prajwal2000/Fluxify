import {
	BaseEdge,
	EdgeLabelRenderer,
	type EdgeProps,
	getBezierPath,
	useReactFlow,
	useStore,
} from "@xyflow/react";
import { useCallback } from "react";
import { TbPlus, TbX } from "react-icons/tb";
import { useQuickAdd } from "../QuickAddContext";
import type { BlockEdge } from "../types";
import { useHoveredEdge } from "./edgeHover";
import "./edges.css";

/**
 * The canvas edge: dashes flow from source to target. Hovering the box between
 * its two blocks (see edgeHover) or selecting it reveals delete and insert buttons sitting on the path itself (React Flow's
 * label coordinates are the curve's midpoint, not the bounding box centre).
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
	const hovered = useHoveredEdge() === id;
	// Scale that grows at half the zoom rate (sqrt): buttons and hit strip stay
	// usable zoomed out without ballooning zoomed in.
	const soften = useStore((state) => 1 / Math.sqrt(state.transform[2]));
	const [path, labelX, labelY] = getBezierPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
	});
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
		void deleteElements({ edges: [{ id }] });
	}, [deleteElements, id]);

	return (
		<>
			{/* Fat transparent path underneath: makes a thin edge easy to select. */}
			<path className="fx-edge__hit" d={path} style={{ strokeWidth: 32 * soften }} />
			<BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} className={edgeClassName} />
			{(selected || hovered) && (
				<EdgeLabelRenderer>
					<div
						className="fx-edge__actions"
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
