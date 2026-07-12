import React, { useContext, useState, useCallback } from "react";
import { Menu, Kbd, Group, Text, Box } from "@mantine/core";
import { BlockCanvasContext } from "@/context/blockCanvas";
import { useReactFlow, useOnSelectionChange, Node, Edge } from "@xyflow/react";
import { useEditorSearchbarStore } from "@/store/editor";
import { useBlockDataStore } from "@/store/blockDataStore";
import { 
  TbCopy, 
  TbClipboardText, 
  TbDeviceFloppy, 
  TbPlus, 
  TbCopy as TbDuplicate,
  TbTransform,
  TbArrowBackUp,
  TbArrowForwardUp
} from "react-icons/tb";
import RefactorToCustomBlockModal from "./refactorToCustomBlockModal";

interface Props {
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export default function CanvasContextMenu({ position, onClose }: Props) {
  const { duplicateSelection, pasteSelection, onSave, copySelection, undo, redo } = useContext(BlockCanvasContext);
  const { open: openSearchbar } = useEditorSearchbarStore();
  const { getNodes, getEdges } = useReactFlow();

  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [refactorModalOpened, setRefactorModalOpened] = useState(false);

  const onChange = useCallback(({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) => {
    setSelectedBlocks(nodes.map((node) => node.id));
    setSelectedEdges(edges.map((edge) => edge.id));
  }, []);

  useOnSelectionChange({ onChange });

  const hasSelection = selectedBlocks.length > 0;
  
  // Refactoring is only possible if > 1 block is selected, and none of them are entrypoint/error_handler/response
  const canRefactor = selectedBlocks.length > 1 && !getNodes().some(
    (node) => 
      selectedBlocks.includes(node.id) && 
      (node.type === "entrypoint" || node.type === "error_handler" || node.type === "response")
  );

  return (
    <>
      <Menu opened={!!position && !refactorModalOpened} onClose={onClose} shadow="md" width={220}>
        <Menu.Target>
          <Box
            style={{
              position: "fixed",
              top: position?.y || 0,
              left: position?.x || 0,
              width: 1,
              height: 1,
              pointerEvents: "none",
            }}
          />
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item fz="sm"
            leftSection={<TbPlus size={14} />}
            rightSection={<Kbd ml="md" size="xs">⇧ + A</Kbd>}
            onClick={() => {
              onClose();
              setTimeout(() => openSearchbar(), 0);
            }}
          >
            Add new
          </Menu.Item>
          
          <Menu.Divider />
          
          <Menu.Item fz="sm"
            leftSection={<TbArrowBackUp size={14} />}
            rightSection={<Kbd ml="md" size="xs">Ctrl + Z</Kbd>}
            onClick={() => {
              undo();
              onClose();
            }}
          >
            Undo
          </Menu.Item>
          <Menu.Item fz="sm"
            leftSection={<TbArrowForwardUp size={14} />}
            rightSection={<Kbd ml="md" size="xs">Ctrl + Y</Kbd>}
            onClick={() => {
              redo();
              onClose();
            }}
          >
            Redo
          </Menu.Item>

          <Menu.Divider />
          <Menu.Item fz="sm"
            leftSection={<TbCopy size={14} />}
            rightSection={<Kbd ml="md" size="xs">Ctrl + C</Kbd>}
            disabled={!hasSelection}
            onClick={() => {
              copySelection();
              onClose();
            }}
          >
            Copy
          </Menu.Item>
          <Menu.Item fz="sm"
            leftSection={<TbClipboardText size={14} />}
            rightSection={<Kbd ml="md" size="xs">Ctrl + V</Kbd>}
            onClick={() => {
              pasteSelection();
              onClose();
            }}
          >
            Paste
          </Menu.Item>
          <Menu.Item fz="sm"
            leftSection={<TbDuplicate size={14} />}
            rightSection={<Kbd ml="md" size="xs">⇧ + D</Kbd>}
            disabled={!hasSelection}
            onClick={() => {
              duplicateSelection(selectedBlocks);
              onClose();
            }}
          >
            Duplicate
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item fz="sm"
            leftSection={<TbTransform size={14} />}
            disabled={!canRefactor}
            onClick={() => setRefactorModalOpened(true)}
          >
            Refactor to custom block
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item fz="sm"
            leftSection={<TbDeviceFloppy size={14} />}
            rightSection={<Kbd ml="md" size="xs">Ctrl + S</Kbd>}
            onClick={() => {
              onSave();
              onClose();
            }}
          >
            Save
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      {refactorModalOpened && (
        <RefactorToCustomBlockModal
          opened={refactorModalOpened}
          onClose={() => {
            setRefactorModalOpened(false);
            onClose();
          }}
          selectedBlocks={selectedBlocks}
        />
      )}
    </>
  );
}
