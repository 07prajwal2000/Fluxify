import { BlockCanvasContext } from "@/context/blockCanvas";
import { useBlockDataStore } from "@/store/blockDataStore";
import { useCanvasActionsStore } from "@/store/canvas";
import {
  useEditorBlockSettingsStore,
  useEditorSearchbarStore,
} from "@/store/editor";
import { Edge, Node, useOnSelectionChange, useReactFlow } from "@xyflow/react";
import React, { useCallback, useContext, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

const CanvasKeyboardAccessibility = () => {
  const [selectedBlocks, setSelectedBlock] = useState<string[]>([]);
  const blockData = useBlockDataStore();
  const { getNodes, getEdges } = useReactFlow();
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const { open: openSearchbar } = useEditorSearchbarStore();
  const { open } = useEditorBlockSettingsStore();
  const { deleteBulk, undo, redo, duplicateSelection } =
    useContext(BlockCanvasContext);
  const onChange = useCallback(
    ({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) => {
      setSelectedBlock(nodes.map((node) => node.id));
      setSelectedEdges(edges.map((edge) => edge.id));
    },
    []
  );

  useOnSelectionChange({
    onChange,
  });
  useHotkeys("enter", onEnterClicked); // select block
  useHotkeys("shift+a", openSearchbar); // open searchbar
  useHotkeys("shift+d", onDuplicateSelection); // duplicate selection
  useHotkeys("ctrl+z", undo); // undo
  useHotkeys("ctrl+c", onCopySelection); // copy selection
  useHotkeys("ctrl+y, ctrl+shift+z", redo); // redo
  useHotkeys("delete, backspace", onDeleteClicked); // delete
  useHotkeys("ctrl+s", (e) => onSaveClicked(e)); // save

  function onSaveClicked(e: KeyboardEvent) {
    e.preventDefault();
    document.body.dispatchEvent(new CustomEvent("save-editor"));
  }

  async function onCopySelection() {
    if (selectedBlocks.length === 0 && selectedEdges.length === 0) {
      return;
    }
    // {blocks: [{id, position, type, data}], edges: [{id, source, target, sourceHandle, targetHandle, type}]}
    const blocks: {
      id: string;
      position: { x: number; y: number };
      type: string;
      data: any;
    }[] = [];
    const edges: {
      id: string;
      source: string;
      target: string;
      sourceHandle: string;
      targetHandle: string;
      type: string;
    }[] = [];
    getNodes().forEach((node) => {
      if (selectedBlocks.includes(node.id)) {
        blocks.push({
          id: node.id,
          position: node.position,
          type: node.type!,
          data: blockData[node.id],
        });
      }
    });
    getEdges().forEach((edge) => {
      if (selectedEdges.includes(edge.id)) {
        edges.push({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle!,
          targetHandle: edge.targetHandle!,
          type: edge.type!,
        });
      }
    });
    await navigator.clipboard.writeText(
      JSON.stringify({ source: "FLUXIFY/COPY_PASTE", data: { blocks, edges } })
    );
  }

  function onDuplicateSelection() {
    if (selectedBlocks.length === 0) return;
    duplicateSelection(selectedBlocks);
  }

  function onEnterClicked() {
    if (selectedBlocks.length !== 1) {
      return;
    }
    open(selectedBlocks[0]);
  }

  function onDeleteClicked(e: KeyboardEvent) {
    if (selectedBlocks.length === 0 && selectedEdges.length === 0) {
      return;
    }

    deleteBulk(selectedBlocks, "block");
    deleteBulk(selectedEdges, "edge");
  }

  return <></>;
};

export default CanvasKeyboardAccessibility;
