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
  } = useBlockHistory();
  const { onEdgeConnect, onBlockDragStop, onBlockDblClick, openBlock } =
    useCanvasEvents();

  // TODO: Need to implement Undo/Redo
  function doAction(_type: "undo" | "redo") {}

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
