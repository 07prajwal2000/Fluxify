import { Box } from "@mantine/core";
import { Background, Panel, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { blocksList } from "../../blocks/blocksList";
import { BaseBlockType } from "@/types/block";
import {
	useCanvasActionsStore,
	useCanvasBlocksStore,
	useCanvasEdgesStore,
} from "@/store/canvas";
import CanvasToolboxPanel from "./toolbox/canvasToolboxPanel";
import { edgeTypes } from "../../blocks/customEdge";
import { BlockCanvasContext } from "@/context/blockCanvas";
import BlockSearchDrawer from "./blockSearchDrawer";
import EditorToolbox from "./editorToolbox";
import BlockSettingsDialog from "../../blocks/settingsDialog/blockSettingsDialog";
import CanvasKeyboardAccessibility from "./canvasKeyboardAccessibility";
import RequireRole from "@/components/auth/requireRole";
import { routesQueries } from "@/query/routerQuery";
import { useBlockHistory } from "@/hooks/useBlockHistory";
import { useCanvasEvents } from "@/hooks/useCanvasEvents";
import { useCanvasSave } from "@/hooks/useCanvasState";
import { useCanvasSnapshot } from "@/hooks/useCanvasSnapshot";
import { useEditorActionsStore } from "@/store/editor";
import {
	useBlockDataStore,
	useBlockDataActionsStore,
} from "@/store/blockDataStore";
import { useEditorChangeTrackerStore } from "@/store/editor";

type Props = {
	readonly?: boolean;
	routeId?: string;
};

const BlockCanvas = ({ readonly, routeId }: Props) => {
	const {
		blocks: { onBlockChange },
		edges: { onEdgeChange },
	} = useCanvasActionsStore();
	const { data: routeData } = routesQueries.getById.useQuery(routeId ?? "");
	const projectId = routeData?.projectId ?? "";

	const blocks = useCanvasBlocksStore();
	const edges = useCanvasEdgesStore();

	const { onSave } = useCanvasSave(routeId ?? "");
	const {
		addBlockWithHistory,
		deleteBlockWithHistory,
		deleteEdgeWithHistory,
		deleteBulkWithHistory,
		duplicateBlock,
		duplicateSelection,
		updateBlockDataWithHistory,
		pasteSelection,
	} = useBlockHistory();
	const { onEdgeConnect, onBlockDragStop, onBlockDblClick, openBlock } =
		useCanvasEvents({ pasteSelection });

	const blockDataStore = useBlockDataStore();
	const { bulkInsert } = useCanvasActionsStore();
	const { bulkInsert: bulkInsertBlockData } = useBlockDataActionsStore();
	const actionsStore = useEditorActionsStore();
	const changeTracker = useEditorChangeTrackerStore();

	useCanvasSnapshot();

	function doAction(_type: "undo" | "redo") {
		actionsStore.disable();
		const currentState = { blocks, edges, blockData: blockDataStore };
		const snapshot =
			_type === "undo"
				? actionsStore.undo(currentState)
				: actionsStore.redo(currentState);

		if (snapshot) {
			const changedBlocks = new Set<string>();
			const changedEdges = new Set<string>();

			// Blocks Diff
			const currentBlockIds = new Set(currentState.blocks.map((b) => b.id));
			const snapshotBlockIds = new Set(snapshot.blocks.map((b) => b.id));

			currentState.blocks.forEach((b) => {
				if (!snapshotBlockIds.has(b.id)) {
					changedBlocks.add(b.id);
				} else {
					const snapB = snapshot.blocks.find((sb) => sb.id === b.id);
					if (
						JSON.stringify(snapB) !== JSON.stringify(b) ||
						JSON.stringify(currentState.blockData[b.id]) !==
							JSON.stringify(snapshot.blockData[b.id])
					) {
						changedBlocks.add(b.id);
					}
				}
			});
			snapshot.blocks.forEach((b) => {
				if (!currentBlockIds.has(b.id)) {
					changedBlocks.add(b.id);
				}
			});

			// Edges Diff
			const currentEdgeIds = new Set(currentState.edges.map((e) => e.id));
			const snapshotEdgeIds = new Set(snapshot.edges.map((e) => e.id));

			currentState.edges.forEach((e) => {
				if (!snapshotEdgeIds.has(e.id)) {
					changedEdges.add(e.id);
				} else {
					const snapE = snapshot.edges.find((se) => se.id === e.id);
					if (JSON.stringify(snapE) !== JSON.stringify(e)) {
						changedEdges.add(e.id);
					}
				}
			});
			snapshot.edges.forEach((e) => {
				if (!currentEdgeIds.has(e.id)) {
					changedEdges.add(e.id);
				}
			});

			changedBlocks.forEach((id) => changeTracker.add(id, "block"));
			changedEdges.forEach((id) => changeTracker.add(id, "edge"));

			bulkInsert(snapshot.blocks, snapshot.edges);
			bulkInsertBlockData(
				Object.entries(snapshot.blockData).map(([id, data]) => ({ id, data })),
			);
		}

		// We set a small delay to enable recording again so the React flow
		// effects don't trigger the snapshot hook
		setTimeout(() => {
			actionsStore.enable();
		}, 100);
	}

	return (
		<Box w="100%" h="100%">
			<BlockCanvasContext.Provider
				value={{
					undo: () => doAction("undo"),
					redo: () => doAction("redo"),
					deleteBlock: deleteBlockWithHistory,
					deleteEdge: deleteEdgeWithHistory,
					addBlock: addBlockWithHistory,
					updateBlockData: updateBlockDataWithHistory,
					openBlock,
					duplicateBlock,
					deleteBulk: deleteBulkWithHistory,
					onSave,
					duplicateSelection,
				}}
			>
				<Box style={{ position: "absolute", zIndex: 10, right: 0 }} p="lg">
					<RequireRole requiredRole="creator" projectId={projectId}>
						<EditorToolbox />
					</RequireRole>
				</Box>

				<ReactFlow
					deleteKeyCode=""
					onEdgesChange={onEdgeChange}
					onNodesChange={onBlockChange}
					onConnect={(e) => onEdgeConnect(e as any)}
					nodes={blocks}
					edges={edges}
					onNodeDragStart={(_, node) => onBlockDragStop(node as BaseBlockType)}
					snapToGrid
					snapGrid={[5, 5]}
					onlyRenderVisibleElements
					selectNodesOnDrag
					onNodeDoubleClick={(_, node) =>
						onBlockDblClick(node as BaseBlockType)
					}
					nodeTypes={blocksList}
					nodesDraggable={!readonly}
					nodesConnectable={!readonly}
					fitView
					zoomOnScroll={false}
					panOnDrag={[0]}
					edgeTypes={edgeTypes}
				>
					<Background />
					<Panel position="bottom-left">
						<CanvasToolboxPanel />
					</Panel>
					<RequireRole requiredRole="creator" projectId={projectId}>
						<CanvasKeyboardAccessibility />
					</RequireRole>
				</ReactFlow>

				<BlockSettingsDialog />
				<BlockSearchDrawer />
			</BlockCanvasContext.Provider>
		</Box>
	);
};

export default BlockCanvas;
