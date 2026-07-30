import { useCallback } from "react";
import {
	BaseEdge,
	EdgeLabelRenderer,
	getBezierPath,
	useReactFlow,
	type EdgeProps,
} from "@xyflow/react";
import { TbX } from "react-icons/tb";
import "./edges.css";

/**
 * The canvas edge: dashes flow from source to target, and selecting it reveals a
 * delete button sitting on the path itself (React Flow's label coordinates are
 * the curve's midpoint, not the bounding box centre).
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
}: EdgeProps) {
	const { deleteElements } = useReactFlow();
	const [path, labelX, labelY] = getBezierPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
	});

	// deleteElements (not setEdges) so the removal reaches onEdgesChange.
	const remove = useCallback(() => {
		void deleteElements({ edges: [{ id }] });
	}, [deleteElements, id]);

	return (
		<>
			{/* Fat transparent path underneath: makes a thin edge easy to select. */}
			<path className="fx-edge__hit" d={path} />
			<BaseEdge
				id={id}
				path={path}
				markerEnd={markerEnd}
				style={style}
				className={`fx-edge${selected ? " fx-edge--selected" : ""}`}
			/>
			{selected && (
				<EdgeLabelRenderer>
					<button
						type="button"
						className="fx-edge__delete"
						style={{
							transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
						}}
						title="Delete connection"
						aria-label="Delete connection"
						onClick={remove}
					>
						<TbX size={10} />
					</button>
				</EdgeLabelRenderer>
			)}
		</>
	);
}
