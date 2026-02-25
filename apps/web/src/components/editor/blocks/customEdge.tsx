import { useCanvasActionsStore } from "@/store/canvas";
import { useEditorChangeTrackerStore } from "@/store/editor";
import { ActionIcon, Box } from "@mantine/core";
import {
	BaseEdge,
	EdgeLabelRenderer,
	EdgeProps,
	EdgeTypes,
	getSmoothStepPath,
} from "@xyflow/react";
import { TbX } from "react-icons/tb";

export const edgeTypes: EdgeTypes = {
	custom: CustomEdge,
};

export function CustomEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	selected,
	source,
	target,
	sourceHandleId,
	targetHandleId,
}: EdgeProps) {
	const [edgePath, labelX, labelY] = getSmoothStepPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
	});
	const { edges } = useCanvasActionsStore();
	const changeTracker = useEditorChangeTrackerStore();

	function onDeleteClick() {
		edges.deleteEdge(id);
		edges.deleteEdge(id);
		changeTracker.add(id, "edge");
	}

	return (
		<>
			<BaseEdge id={id} path={edgePath} />
			<EdgeLabelRenderer>
				<Box
					style={{
						position: "absolute",
						transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
						pointerEvents: "all",
					}}
					className="nodrag nopan"
				>
					<ActionIcon
						onClick={onDeleteClick}
						style={{ visibility: selected ? "visible" : "hidden" }}
						size={12}
						c={"white"}
						color="dark"
					>
						<TbX size={8} />
					</ActionIcon>
				</Box>
			</EdgeLabelRenderer>
		</>
	);
}
