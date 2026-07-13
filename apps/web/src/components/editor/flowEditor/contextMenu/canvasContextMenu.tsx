import React, { useContext, useState, useCallback } from "react";
import { Menu, Kbd, Group, Text, Box } from "@mantine/core";
import { BlockCanvasContext } from "@/context/blockCanvas";
import { useReactFlow, useOnSelectionChange, Node, Edge } from "@xyflow/react";
import { useEditorSearchbarStore, useEditorActionsStore, useEditorBlockSettingsStore } from "@/store/editor";
import { useBlockDataStore } from "@/store/blockDataStore";
import { 
  TbCopy, 
  TbClipboardText, 
  TbDeviceFloppy, 
  TbPlus, 
  TbCopy as TbDuplicate,
  TbTransform,
  TbArrowBackUp,
  TbArrowForwardUp,
  TbSettings,
  TbExternalLink
} from "react-icons/tb";
import RefactorToCustomBlockModal from "./refactorToCustomBlockModal";

interface Props {
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export default function CanvasContextMenu({ position, onClose }: Props) {
  const { duplicateSelection, pasteSelection, onSave, copySelection, undo, redo } = useContext(BlockCanvasContext);
  const { open: openSearchbar } = useEditorSearchbarStore();
  const { open } = useEditorBlockSettingsStore();
  const { getNodes, getEdges } = useReactFlow();
  const { undoStack, redoStack } = useEditorActionsStore();
  const disableUndo = undoStack.length === 0;
  const disableRedo = redoStack.length === 0;

  const [selectedBlocks, setSelectedBlocks] = useState<string[]>(() => getNodes().filter(n => n.selected).map(n => n.id));
  const [selectedEdges, setSelectedEdges] = useState<string[]>(() => getEdges().filter(e => e.selected).map(e => e.id));
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

  const [lastPosition, setLastPosition] = useState(position);

  React.useEffect(() => {
    if (position) {
      setLastPosition(position);
    }
  }, [position]);

  return (
    <>
      <Menu 
        opened={!!position && !refactorModalOpened} 
        onClose={onClose} 
        shadow="md" 
        width={220}
        styles={{
          item: { padding: "4px 10px", minHeight: 32 },
          itemLabel: { fontSize: 13 },
        }}
      >
        <Menu.Target>
          <Box
            style={{
              position: "fixed",
              top: lastPosition?.y || 0,
              left: lastPosition?.x || 0,
              width: 1,
              height: 1,
              pointerEvents: "none",
            }}
          />
        </Menu.Target>

        <Menu.Dropdown>
          {selectedBlocks.length === 1 && (
            <Menu.Item fz={13} style={{ minHeight: 28, padding: "4px 8px" }}
              leftSection={<TbExternalLink size={14} />}
              rightSection={<Kbd ml="md" size="xs" p="2px 4px">Enter</Kbd>}
              onClick={() => {
                open(selectedBlocks[0]);
                onClose();
              }}
            >
              Open
            </Menu.Item>
          )}

          <Menu.Item fz={13} style={{ minHeight: 28, padding: "4px 8px" }}
            leftSection={<TbPlus size={14} />}
            rightSection={<Kbd ml="md" size="xs" p="2px 4px">⇧ + A</Kbd>}
            onClick={() => {
              onClose();
              setTimeout(() => openSearchbar(), 0);
            }}
          >
            Add new
          </Menu.Item>
          
          <Menu.Divider />
          
          <Menu.Item fz={13} style={{ minHeight: 28, padding: "4px 8px" }}
            leftSection={<TbArrowBackUp size={14} />}
            rightSection={<Kbd ml="md" size="xs" p="2px 4px">Ctrl + Z</Kbd>}
            disabled={disableUndo}
            onClick={() => {
              undo();
              onClose();
            }}
          >
            Undo
          </Menu.Item>
          <Menu.Item fz={13} style={{ minHeight: 28, padding: "4px 8px" }}
            leftSection={<TbArrowForwardUp size={14} />}
            rightSection={<Kbd ml="md" size="xs" p="2px 4px">Ctrl + Y</Kbd>}
            disabled={disableRedo}
            onClick={() => {
              redo();
              onClose();
            }}
          >
            Redo
          </Menu.Item>

          <Menu.Divider />
          <Menu.Item fz={13} style={{ minHeight: 28, padding: "4px 8px" }}
            leftSection={<TbCopy size={14} />}
            rightSection={<Kbd ml="md" size="xs" p="2px 4px">Ctrl + C</Kbd>}
            disabled={!hasSelection}
            onClick={() => {
              copySelection();
              onClose();
            }}
          >
            Copy
          </Menu.Item>
          <Menu.Item fz={13} style={{ minHeight: 28, padding: "4px 8px" }}
            leftSection={<TbClipboardText size={14} />}
            rightSection={<Kbd ml="md" size="xs" p="2px 4px">Ctrl + V</Kbd>}
            onClick={() => {
              pasteSelection();
              onClose();
            }}
          >
            Paste
          </Menu.Item>
          <Menu.Item fz={13} style={{ minHeight: 28, padding: "4px 8px" }}
            leftSection={<TbDuplicate size={14} />}
            rightSection={<Kbd ml="md" size="xs" p="2px 4px">⇧ + D</Kbd>}
            disabled={!hasSelection}
            onClick={() => {
              duplicateSelection(selectedBlocks);
              onClose();
            }}
          >
            Duplicate
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item fz={13} style={{ minHeight: 28, padding: "4px 8px" }}
            leftSection={<TbTransform size={14} />}
            disabled={!canRefactor}
            onClick={() => setRefactorModalOpened(true)}
          >
            Refactor to custom block
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item fz={13} style={{ minHeight: 28, padding: "4px 8px" }}
            leftSection={<TbDeviceFloppy size={14} />}
            rightSection={<Kbd ml="md" size="xs" p="2px 4px">Ctrl + S</Kbd>}
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
