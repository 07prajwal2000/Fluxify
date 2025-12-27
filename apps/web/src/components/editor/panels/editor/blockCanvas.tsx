import { Box } from "@mantine/core";
import { Background, Panel, ReactFlow, useReactFlow } from "@xyflow/react";
import React, { useEffect } from "react";
import "@xyflow/react/dist/style.css";
import { blocksList } from "../../blocks/blocksList";
import {
  useEditorActionsStore,
  useEditorBlockSettingsStore,
  useEditorChangeTrackerStore,
} from "@/store/editor";
import { BaseBlockType, BlockTypes, EdgeType } from "@/types/block";
import {
  useCanvasActionsStore,
  useCanvasBlocksStore,
  useCanvasEdgesStore,
} from "@/store/canvas";
import CanvasToolboxPanel from "./toolbox/canvasToolboxPanel";
import { generateID } from "@fluxify/lib";
import { edgeTypes } from "../../blocks/customEdge";
import { notifications, showNotification } from "@mantine/notifications";
import { BlockCanvasContext } from "@/context/blockCanvas";
import BlockSearchDrawer from "./blockSearchDrawer";
import { createBlockData } from "@/lib/blockFactory";
import EditorToolbox from "./editorToolbox";
import BlockSettingsDialog from "../../blocks/settingsDialog/blockSettingsDialog";
import {
  useBlockDataActionsStore,
  useBlockDataStore,
} from "@/store/blockDataStore";
import CanvasKeyboardAccessibility from "./canvasKeyboardAccessibility";
import { useParams } from "next/navigation";
import { routesService } from "@/services/routes";
import RequireRole from "@/components/auth/requireRole";
import { routesQueries } from "@/query/routerQuery";

type Props = {
  readonly?: boolean;
  routeId?: string;
};

const BlockCanvas = (props: Props) => {
  const {
    blocks: {
      onBlockChange,
      deleteBlock,
      addBlock,
      deleteBulk: deleteBulkBlocks,
    },
    edges: { onEdgeChange, addEdge, deleteEdge, deleteBulk: deleteBulkEdges },
  } = useCanvasActionsStore();
  const { data: routeData } = routesQueries.getById.useQuery(
    props.routeId || ""
  );
  const projectId = routeData?.projectId || "";
  const { updateBlockData, deleteBlockData } = useBlockDataActionsStore();
  const actions = useEditorActionsStore();
  const blocks = useCanvasBlocksStore();
  const edges = useCanvasEdgesStore();
  const changeTracker = useEditorChangeTrackerStore();
  const { screenToFlowPosition } = useReactFlow();
  const blockSettings = useEditorBlockSettingsStore();
  const blockDataStore = useBlockDataStore();

  useEffect(() => {
    window.onbeforeunload = preventRefresh;
    return () => {
      window.onbeforeunload = null;
    };
  }, [changeTracker.tracker]);

  function preventRefresh(e: BeforeUnloadEvent) {
    if (changeTracker.tracker.size === 0) {
      return;
    }
    const confirmed = confirm(
      "You have unsaved changes, are you sure you want to leave?"
    );
    if (confirmed) {
      return;
    }
    e.preventDefault();
  }

  const { id: routeId } = useParams<{ id: string }>();
  // TODO: Need to implement Undo/Redo
  function doAction(type: "undo" | "redo") {
    // NOT IMPLEMENTED YET
  }
  function deleteBulkWithHistory(ids: string[], type: "block" | "edge") {
    if (type === "block") {
      deleteBulkBlocks(new Set(ids));
    } else {
      deleteBulkEdges(new Set(ids));
    }
    // TODO: Add to change tracker
    ids.forEach((id) => {
      changeTracker.add(id, type);
    });
  }
  function deleteEdgeWithHistory(id: string) {
    changeTracker.add(id, "edge");
    deleteEdge(id);
  }
  function deleteBlockWithHistory(id: string) {
    changeTracker.add(id, "block");
    // delete edges connected to this block
    edges
      .filter((edge) => edge.source === id || edge.target === id)
      .forEach((edge) => {
        deleteEdgeWithHistory(edge.id);
      });
    deleteBlock(id);
    deleteBlockData(id);
  }
  function addBlockWithHistory(block: BlockTypes) {
    const position = screenToFlowPosition({
      x: document.body.offsetWidth / 2,
      y: document.body.offsetHeight / 2,
    });
    const data = createBlockData(block);
    const id = generateID();
    createNewBlock(id, position, block, data);
  }
  function createNewBlock(
    id: string,
    position: { x: number; y: number },
    block: BlockTypes,
    data?: any
  ) {
    data = data || createBlockData(block);
    addBlock({
      id,
      position,
      type: block,
      data,
    });
    updateBlockData(id, data);
    changeTracker.add(id, "block");
  }
  function updateBlockDataWithHistory(id: string, data: any) {
    changeTracker.add(id, "block");
    updateBlockData(id, data);
  }
  function onBlockDragStop(block: BaseBlockType) {
    changeTracker.add(block.id, "block");
  }
  function onEdgeConnect(edge: EdgeType) {
    if (edge.source === edge.target) {
      showNotification({
        title: "Error",
        message: "Cannot connect to itself",
        color: "red",
      });
      return;
    }
    edge.id = generateID();
    changeTracker.add(edge.id, "edge");
    // @ts-ignore
    edge.type = "custom";
    actions.record(
      JSON.parse(
        JSON.stringify({
          variant: "edge",
          actionType: "add",
          ...edge,
        })
      )
    );
    addEdge(edge);
  }
  function onBlockDblClick(block: BaseBlockType) {
    blockSettings.open(block.id);
  }
  function openBlock(id: string) {
    blockSettings.open(id);
  }
  function duplicateBlock(id: string) {
    const block = blocks.find((block) => block.id === id);
    if (!block) {
      return;
    }
    const position = { x: block.position.x + 50, y: block.position.y + 50 };
    const newId = generateID();
    createNewBlock(newId, position, block.type, block.data);
  }
  async function onSave() {
    const notificationId = "canvas-save-success";
    try {
      const blocksMap = new Map<string, (typeof blocks)[0]>();
      const edgesMap = new Map<string, (typeof edges)[0]>();
      const blockActionsToPerform: {
        id: string;
        action: "upsert" | "delete";
      }[] = [];
      const edgeActionsToPerform: {
        id: string;
        action: "upsert" | "delete";
      }[] = [];

      blocks.forEach((block) => blocksMap.set(block.id, block));
      edges.forEach((edge) => edgesMap.set(edge.id, edge));

      const blocksToSave: typeof blocks = [];
      const edgesToSave: typeof edges = [];

      changeTracker.tracker.forEach((value, key) => {
        if (value === "block") {
          const exist = blocksMap.has(key);
          blockActionsToPerform.push({
            id: key,
            action: exist ? "upsert" : "delete",
          });
          if (exist) {
            const blockData = blockDataStore[key];
            const block = blocksMap.get(key)!;
            block.data = blockData;
            blocksToSave.push(block);
          }
        } else if (value === "edge") {
          const exist = edgesMap.has(key);
          edgeActionsToPerform.push({
            id: key,
            action: exist ? "upsert" : "delete",
          });
          if (exist) {
            edgesToSave.push(edgesMap.get(key)!);
          }
        }
      });

      notifications.show({
        id: notificationId,
        loading: true,
        message: "Saving...",
        color: "violet",
        withCloseButton: true,
      });

      await routesService.saveCanvasItems(routeId, {
        actionsToPerform: {
          blocks: blockActionsToPerform,
          edges: edgeActionsToPerform,
        },
        changes: {
          blocks: blocksToSave,
          edges: edgesToSave.map((edge) => ({
            id: edge.id,
            fromHandle: edge.sourceHandle,
            toHandle: edge.targetHandle,
            from: edge.source,
            to: edge.target,
          })),
        },
      });

      changeTracker.reset();
      notifications.update({
        id: notificationId,
        loading: false,
        message: "Successfully saved",
        color: "green",
        withCloseButton: true,
      });
    } catch (error: any) {
      notifications.update({
        id: notificationId,
        loading: false,
        withCloseButton: true,
        color: "red",
        message: "Failed to save",
      });
    }
  }

  return (
    <Box w={"100%"} h={"100%"}>
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
        }}
      >
        <Box style={{ position: "absolute", zIndex: 10, right: 0 }} p={"lg"}>
          <RequireRole requiredRole="creator" projectId={projectId}>
            <EditorToolbox />
          </RequireRole>
        </Box>
        <ReactFlow
          deleteKeyCode={""}
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
          onNodeDoubleClick={(_, node) => onBlockDblClick(node)}
          nodeTypes={blocksList}
          nodesDraggable={!props.readonly}
          nodesConnectable={!props.readonly}
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
